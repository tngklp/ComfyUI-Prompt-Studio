import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from backend.models.contract import ModelError
from prompt_studio.managed_gguf import ManagedGGUFBackend


class ManagedGenerationErrorTests(unittest.TestCase):
    def backend(self, error, exit_code):
        runtime = Mock()
        runtime.status.return_value = {"log_path": "data/logs/llama-server.log", "exit_code": exit_code}
        runtime.stop.side_effect = lambda: runtime.status.return_value.update(exit_code=None)
        external = Mock()
        external.generate.side_effect = error
        backend = ManagedGGUFBackend(SimpleNamespace(runtime=runtime), external, ModelError, {})
        backend._remote_model = {"id": "ps-managed"}
        return backend, runtime

    def test_transport_failure_keeps_diagnostics_before_unload(self):
        for code in ("EXTERNAL_SERVER_UNAVAILABLE", "EXTERNAL_STREAM_INTERRUPTED"):
            for exit_code in (3, None):
                with self.subTest(code=code, exit_code=exit_code):
                    original = ModelError(code, "Connection interrupted.", {"reason": "connection reset"})
                    backend, runtime = self.backend(original, exit_code)
                    with self.assertRaises(ModelError) as raised:
                        backend.generate({}, {}, "session")
                    self.assertEqual(raised.exception.code, "MANAGED_SERVER_INTERRUPTED")
                    self.assertIn("Local GGUF", raised.exception.message)
                    self.assertEqual(raised.exception.details, {
                        "reason": "connection reset", "transport_code": code,
                        "log_path": "data/logs/llama-server.log", "exit_code": exit_code,
                    })
                    self.assertIs(raised.exception.__cause__, original)
                    runtime.stop.assert_called_once()
                    self.assertIsNone(runtime.status()["exit_code"])

    def test_cancellation_and_other_errors_are_not_reported_as_server_crashes(self):
        for code in ("GENERATION_CANCELLED", "EXTERNAL_SERVER_ERROR", "CONTEXT_BUDGET_EXCEEDED"):
            with self.subTest(code=code):
                original = ModelError(code, "Original message.", {"status": 400})
                backend, runtime = self.backend(original, None)
                with self.assertRaises(ModelError) as raised:
                    backend.generate({}, {}, "session", unload_after=False)
                self.assertIs(raised.exception, original)
                runtime.status.assert_not_called()
                runtime.stop.assert_not_called()
