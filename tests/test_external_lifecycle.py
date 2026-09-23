import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from backend.models.contract import ModelError
from backend.models.external_server_backend import ExternalServerBackend


class RouterHandler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        auth = self.headers.get("Authorization")
        self.server.headers.append(auth)
        if auth != "Bearer test-secret":
            self.reply({"error": {"message": "Unauthorized test-secret"}}, 401)
            return False
        return True

    def do_GET(self):
        if not self.authorized():
            return
        if self.path == "/health":
            self.reply({"status": "ok"})
        elif self.path == "/models":
            self.server.polls += 1
            if self.server.pending and self.server.polls >= 3:
                self.server.states["writer"] = self.server.pending
                self.server.pending = None
            self.reply({"data": [{"id": key, "status": {"value": value},
                                 "architecture": {"input_modalities": ["text", "image"]}}
                                for key, value in self.server.states.items()]})
        elif self.path.startswith("/props?model=writer&autoload=false"):
            self.reply({"n_ctx": 8192, "modalities": {"vision": True}})
        else:
            self.reply({}, 404)

    def do_POST(self):
        if not self.authorized():
            return
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.server.actions.append((self.path, body))
        if body.get("model") != "writer":
            self.reply({}, 400)
            return
        self.server.pending = "loaded" if self.path == "/models/load" else "unloaded"
        self.server.polls = 0
        self.reply({"success": True})


class ExternalLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), RouterHandler)
        self.server.states = {"writer": "unloaded", "unrelated": "loaded"}
        self.server.pending = None
        self.server.polls = 0
        self.server.actions = []
        self.server.headers = []
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.backend = ExternalServerBackend()
        self.config = {"url": f"http://127.0.0.1:{self.server.server_port}", "model": "writer", "api_key": "test-secret"}

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_probe_auth_exact_identity_and_no_implicit_load(self):
        model = self.backend.probe_model(self.config)
        self.assertTrue(model["lifecycle_supported"])
        self.assertTrue(model["capabilities"]["images"])
        self.assertNotIn("test-secret", json.dumps(model))
        self.assertEqual(self.server.actions, [])
        with self.assertRaises(ModelError) as error:
            self.backend.probe_model({**self.config, "model": ""})
        self.assertEqual(error.exception.code, "EXTERNAL_MODEL_AMBIGUOUS")
        with self.assertRaises(ModelError):
            self.backend.unload("unrelated")
        self.assertEqual(self.server.actions, [])

    def test_load_and_unload_wait_for_observed_state_not_http_success(self):
        model = self.backend.probe_model(self.config)
        with patch("backend.models.external_lifecycle.time.sleep"):
            self.backend.router.transition(model["id"], True)
            self.assertEqual(self.server.states["writer"], "loaded")
            self.assertGreaterEqual(self.server.polls, 3)
            self.backend.unload(model["id"])
        self.assertEqual(self.server.states, {"writer": "unloaded", "unrelated": "loaded"})
        self.assertEqual(self.server.actions, [("/models/load", {"model": "writer"}), ("/models/unload", {"model": "writer"})])
        self.assertTrue(all(header == "Bearer test-secret" for header in self.server.headers))

    def test_generation_keep_loaded_and_automatic_unload(self):
        model = self.backend.probe_model(self.config)
        assembled = {"messages": [{"role": "user", "content": "test"}], "media_inputs": []}
        with patch("backend.models.external_lifecycle.time.sleep"), patch("backend.models.external_server_backend.run_pipeline", return_value={"prompt": "ok"}):
            for keep in [True, False]:
                self.backend.prepare_request()
                self.backend.generate(model, assembled, "test", thinking=False, seed=None, unload_after=not keep)
                self.assertEqual(self.server.states["writer"], "loaded" if keep else "unloaded")

    def test_loading_model_is_awaited_without_duplicate_load(self):
        model = self.backend.probe_model(self.config)
        self.server.states["writer"] = "loading"
        self.server.pending = "loaded"
        self.server.polls = 0
        with patch("backend.models.external_lifecycle.time.sleep"):
            self.backend.router.transition(model["id"], True)
        self.assertEqual(self.server.states["writer"], "loaded")
        self.assertEqual(self.server.actions, [])

    def test_sleeping_child_is_restarted_before_confirming_loaded(self):
        model = self.backend.probe_model(self.config)
        self.server.states["writer"] = "sleeping"
        with patch("backend.models.external_lifecycle.time.sleep"):
            self.backend.router.transition(model["id"], True)
        self.assertEqual(self.server.states["writer"], "loaded")
        self.assertEqual([path for path, _ in self.server.actions], ["/models/unload", "/models/load"])

    def test_http_success_without_state_transition_times_out(self):
        model = self.backend.probe_model(self.config)
        with patch.object(self.backend.router, "state", return_value={"value": "loading"}):
            with self.assertRaises(ModelError) as error:
                self.backend.router.transition(model["id"], True, timeout=0)
        self.assertEqual(error.exception.code, "EXTERNAL_LIFECYCLE_TIMEOUT")

    def test_cancel_unloads_even_with_keep_loaded(self):
        model = self.backend.probe_model(self.config)
        def cancelled(*args, **kwargs):
            self.backend.request_unload()
            raise ModelError("GENERATION_CANCELLED", "Cancelled")
        with patch("backend.models.external_lifecycle.time.sleep"), patch("backend.models.external_server_backend.run_pipeline", side_effect=cancelled):
            with self.assertRaises(ModelError):
                self.backend.generate(model, {"messages": [], "media_inputs": []}, "test", thinking=False, seed=None, unload_after=False)
        self.assertEqual(self.server.states["writer"], "unloaded")

    def test_lost_router_state_is_not_reported_as_released(self):
        model = self.backend.probe_model(self.config)
        with patch.object(self.backend.router, "entries", side_effect=ModelError("OFFLINE", "Offline")):
            self.assertEqual(self.backend.router.residency()["targets"][0]["state"], "unknown")
            with self.assertRaises(ModelError):
                self.backend.unload(model["id"])

    def test_auth_errors_redact_the_key_and_newlines_are_rejected(self):
        self.backend.probe_model(self.config)
        with patch.object(self.backend, "_auth_headers", return_value={}):
            with self.assertRaises(ModelError) as error:
                self.backend.probe_model({"url": self.config["url"], "model": "writer"})
        self.assertNotIn("test-secret", str(error.exception) + str(error.exception.details))
        with self.assertRaises(ModelError):
            self.backend.probe_model({**self.config, "api_key": "bad\nheader"})

    def test_cleanup_failure_preserves_success_and_primary_error(self):
        model = self.backend.probe_model(self.config)
        assembled = {"messages": [], "media_inputs": []}
        def transition(_id, loaded, *args):
            if not loaded:
                raise ModelError("UNLOAD_FAILED", "Offline")
        with patch.object(self.backend.router, "transition", side_effect=transition):
            with patch("backend.models.external_server_backend.run_pipeline", return_value={"prompt": "keep this"}):
                result = self.backend.generate(model, assembled, "test", thinking=False, seed=None, unload_after=True)
                self.assertEqual(result["prompt"], "keep this")
                self.assertIn("lifecycle_warning", result)
            with patch("backend.models.external_server_backend.run_pipeline", side_effect=ModelError("PRIMARY", "original error")):
                with self.assertRaises(ModelError) as error:
                    self.backend.generate(model, assembled, "test", thinking=False, seed=None, unload_after=True)
                self.assertEqual(error.exception.code, "PRIMARY")

    def test_residency_batches_models_by_endpoint_and_snapshot_never_waits(self):
        router = self.backend.router
        model = self.backend.probe_model(self.config)
        router.register({**model, "id": "other", "remote_model": "unrelated"})
        with patch.object(router, "entries", wraps=router.entries) as entries:
            self.assertEqual(len(router.residency()["targets"]), 2)
            entries.assert_called_once()
        router._owned.add(model["id"])
        entered, release = threading.Event(), threading.Event()
        def offline(_endpoint):
            entered.set()
            release.wait(2)
            raise ModelError("OFFLINE", "Offline")
        with patch.object(router, "entries", side_effect=offline) as entries:
            first = router.snapshot()
            self.assertTrue(entered.wait(1))
            self.assertTrue(all(t["state"] == "unknown" for t in first["targets"]))
            second = router.snapshot()
            self.assertEqual(first, second)
            self.assertEqual(entries.call_count, 1)
            release.set()
        # Direct/Ollama status can use snapshots even while that network worker is pending.

    def test_external_networking_stays_loopback_only(self):
        from backend.models.external_server_backend import normalize_server_url
        for host in ["192.168.1.20", "172.17.0.1", "169.254.169.254", "8.8.8.8", "router.local"]:
            with self.subTest(host=host), self.assertRaises(ModelError):
                normalize_server_url("http://" + host + ":8080")
        self.assertEqual(normalize_server_url("http://localhost:8004/v1"),"http://localhost:8004")

    def test_confirmed_ownership_survives_stale_and_failed_refresh_until_release(self):
        router = self.backend.router
        model = self.backend.probe_model(self.config)
        self.assertFalse(router.snapshot()["targets"][0]["writer_owned"])
        with patch("backend.models.external_lifecycle.time.sleep"):
            router.transition(model["id"], True)
        router._snapshot[model["endpoint"]]["time"] -= 10
        with patch("backend.models.external_lifecycle.threading.Thread"):
            stale = router.snapshot()["targets"][0]
        self.assertEqual(stale["state"], "unknown")
        self.assertTrue(stale["writer_owned"])
        with patch.object(router, "entries", side_effect=ModelError("OFFLINE", "Offline")):
            router._refresh_snapshot([model["endpoint"]], router._revision)
        self.assertTrue(router.snapshot()["targets"][0]["writer_owned"])
        self.server.states["writer"] = "unloaded"
        router._refresh_snapshot([model["endpoint"]], router._revision)
        released = router.snapshot()["targets"][0]
        self.assertEqual(released["state"], "unloaded")
        self.assertFalse(released["writer_owned"])
