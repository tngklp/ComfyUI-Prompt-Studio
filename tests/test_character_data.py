"""First-launch character dataset acquisition.

The catalogue is downloaded rather than shipped, which moves a network dependency
into startup. These tests pin the properties that make that safe:

1. the studio is fully usable while the download is missing, running or failed;
2. a corrupt or truncated cache is treated as absent, so an interrupted download
   self-heals instead of bricking the picker;
3. the cache write is atomic, so a reader never sees a half-written index; and
4. the background fetch runs once per process, not once per caller.

Every network call is stubbed. A test suite that reaches the internet is a test
suite that fails on a plane.
"""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from backend import character_data, characters

SAMPLE_CSV = """character,copyright,trigger,core_tags,count,url
hatsune_miku,vocaloid,"hatsune miku, vocaloid","1girl, aqua eyes, twintails",103500,https://danbooru.donmai.us/posts?tags=hatsune_miku
hakurei_reimu,touhou,"hakurei reimu, touhou","1girl, brown eyes, hair bow",78109,https://danbooru.donmai.us/posts?tags=hakurei_reimu
kirisame_marisa,touhou,"kirisame marisa, touhou","1girl, blonde hair, witch hat",70313,https://danbooru.donmai.us/posts?tags=kirisame_marisa
"""


def _big_csv(rows: int = character_data.MIN_CACHEABLE_CHARACTERS + 5) -> str:
    """A CSV large enough to be treated as a real catalogue rather than a sample."""
    lines = ["character,copyright,trigger,core_tags,count,url"]
    for index in range(rows):
        lines.append(
            f'character_{index},series_{index},"character {index}, series {index}",'
            f'"1girl, tag_{index}",{1000 - index},https://example.invalid/{index}'
        )
    return "\n".join(lines) + "\n"


def _response(body: bytes, status: int = 200):
    """Minimal stand-in for an http.client.HTTPResponse used as a context manager."""
    stream = mock.MagicMock()
    stream.status = status
    stream.read.return_value = body
    stream.__enter__ = mock.MagicMock(return_value=stream)
    stream.__exit__ = mock.MagicMock(return_value=False)
    return stream


class DatasetDownloadTests(unittest.TestCase):
    def test_the_public_url_is_used(self):
        self.assertEqual(
            character_data.DATASET_URL,
            "https://blobs.animadex.net/export/characters.csv",
        )

    def test_a_successful_download_returns_decoded_text(self):
        with mock.patch.object(
            character_data.urllib.request, "urlopen", return_value=_response(b"a,b\n1,2\n")
        ):
            self.assertEqual(character_data.download_dataset(), "a,b\n1,2\n")

    def test_the_request_identifies_the_studio(self):
        captured = {}

        def capture(request, timeout=None):
            captured["request"] = request
            captured["timeout"] = timeout
            return _response(b"ok")

        with mock.patch.object(character_data.urllib.request, "urlopen", side_effect=capture):
            character_data.download_dataset()
        agent = captured["request"].get_header("User-agent")
        # A default urllib agent would make this traffic anonymous in a mirror's logs.
        self.assertIn("PromptStudio", agent)
        self.assertIsNotNone(captured["timeout"])

    def test_a_network_failure_raises_a_coded_error(self):
        import urllib.error

        with mock.patch.object(
            character_data.urllib.request,
            "urlopen",
            side_effect=urllib.error.URLError("name or service not known"),
        ):
            with self.assertRaises(character_data.CharacterDownloadError) as caught:
                character_data.download_dataset()
        self.assertEqual(caught.exception.code, "CHARACTER_DOWNLOAD_FAILED")

    def test_an_http_error_raises_a_coded_error(self):
        import urllib.error

        error = urllib.error.HTTPError(
            character_data.DATASET_URL, 503, "Service Unavailable", {}, None
        )
        with mock.patch.object(character_data.urllib.request, "urlopen", side_effect=error):
            with self.assertRaises(character_data.CharacterDownloadError) as caught:
                character_data.download_dataset()
        self.assertEqual(caught.exception.code, "CHARACTER_DOWNLOAD_FAILED")
        self.assertIn("503", caught.exception.message)

    def test_a_non_utf8_response_raises_a_coded_error(self):
        with mock.patch.object(
            character_data.urllib.request, "urlopen", return_value=_response(b"\xff\xfe\x00bad")
        ):
            with self.assertRaises(character_data.CharacterDownloadError) as caught:
                character_data.download_dataset()
        self.assertEqual(caught.exception.code, "CHARACTER_DOWNLOAD_FAILED")

    def test_a_response_that_is_not_a_csv_is_rejected(self):
        # An HTML error page from a proxy is the realistic version of this: it carries
        # a 200 and no 'character' column.
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "cache.json"
            with mock.patch.object(
                character_data.urllib.request,
                "urlopen",
                return_value=_response(b"<html><body>Not found</body></html>"),
            ):
                with self.assertRaises(character_data.CharacterDownloadError) as caught:
                    character_data.refresh_cache(path=path)
            self.assertEqual(caught.exception.code, "CHARACTER_DATASET_INVALID")
            self.assertFalse(path.exists(), "a rejected payload must not be cached")

    def test_a_truncated_catalogue_is_rejected(self):
        # One row is not the catalogue. Caching it would silently replace a working
        # index with a nearly empty one.
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "cache.json"
            with mock.patch.object(
                character_data.urllib.request, "urlopen", return_value=_response(SAMPLE_CSV.encode())
            ):
                with self.assertRaises(character_data.CharacterDownloadError) as caught:
                    character_data.refresh_cache(path=path)
            self.assertEqual(caught.exception.code, "CHARACTER_DATASET_INVALID")
            self.assertFalse(path.exists())


class CacheWriteTests(unittest.TestCase):
    def test_a_download_populates_the_cache_and_the_index(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "cache.json"
            with mock.patch.object(
                character_data.urllib.request,
                "urlopen",
                return_value=_response(_big_csv().encode()),
            ):
                index = character_data.refresh_cache(path=path)
            self.assertTrue(path.is_file())
            self.assertEqual(len(index), character_data.MIN_CACHEABLE_CHARACTERS + 5)
            loaded = character_data.load_cache(path)
            self.assertIsNotNone(loaded)
            self.assertEqual(len(loaded), len(index))

    def test_the_cache_round_trips_a_trigger_exactly(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "cache.json"
            with mock.patch.object(
                character_data.urllib.request,
                "urlopen",
                return_value=_response(_big_csv().encode()),
            ):
                character_data.refresh_cache(path=path)
            loaded = character_data.load_cache(path)
            entry = loaded.lookup("character 7") or loaded.lookup("character_7")
            self.assertIsNotNone(entry)
            self.assertEqual(entry.trigger, "character 7, series 7")

    def test_the_cache_write_leaves_no_temp_files(self):
        # A stray 4 MB temp file per failed attempt would fill the directory, and the
        # atomic write is the only reason a reader can never see a partial index.
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "cache.json"
            with mock.patch.object(
                character_data.urllib.request,
                "urlopen",
                return_value=_response(_big_csv().encode()),
            ):
                character_data.refresh_cache(path=path)
            leftovers = [item.name for item in Path(folder).iterdir() if item.name != "cache.json"]
            self.assertEqual(leftovers, [])

    def test_a_missing_cache_is_not_stale_forever(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertTrue(character_data.cache_is_stale(Path(folder) / "absent.json"))

    def test_a_fresh_cache_is_not_stale(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "cache.json"
            path.write_text("{}", encoding="utf-8")
            self.assertFalse(character_data.cache_is_stale(path))

    def test_an_old_cache_is_stale(self):
        import os
        import time

        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "cache.json"
            path.write_text("{}", encoding="utf-8")
            old = time.time() - character_data.CACHE_MAX_AGE_SECONDS - 60
            os.utime(path, (old, old))
            self.assertTrue(character_data.cache_is_stale(path))


class CacheReadTests(unittest.TestCase):
    def test_a_missing_cache_reads_as_absent(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertIsNone(character_data.load_cache(Path(folder) / "absent.json"))

    def test_a_corrupt_cache_reads_as_absent(self):
        # This is the interrupted-download case. Raising here would brick the picker
        # with no way for the user to recover.
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "cache.json"
            path.write_text('{"characters": [{"character": "trunc', encoding="utf-8")
            self.assertIsNone(character_data.load_cache(path))

    def test_a_cache_with_too_few_rows_reads_as_absent(self):
        # A tiny cache is the signature of a bad download, and using it would be worse
        # than using the committed sample.
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "cache.json"
            path.write_text(
                json.dumps({"characters": [{"character": "a", "trigger": "a, b"}]}),
                encoding="utf-8",
            )
            self.assertIsNone(character_data.load_cache(path))

    def test_a_json_array_instead_of_an_object_reads_as_absent(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "cache.json"
            path.write_text("[]", encoding="utf-8")
            self.assertIsNone(character_data.load_cache(path))

    def test_rows_without_a_character_are_skipped(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "cache.json"
            rows = [{"trigger": "no character here"}]
            rows += [
                {"character": f"c{index}", "trigger": f"c{index}, s{index}", "count": 1}
                for index in range(character_data.MIN_CACHEABLE_CHARACTERS)
            ]
            path.write_text(json.dumps({"characters": rows}), encoding="utf-8")
            loaded = character_data.load_cache(path)
            self.assertIsNotNone(loaded)
            self.assertEqual(len(loaded), character_data.MIN_CACHEABLE_CHARACTERS)
            self.assertIsNone(loaded.lookup("no character here"))


class StartupFetchTests(unittest.TestCase):
    def setUp(self):
        character_data.reset_startup_state()
        characters.use_index(None)

    def tearDown(self):
        character_data.reset_startup_state()
        characters.use_index(None)

    def test_a_fresh_cache_is_not_downloaded_again(self):
        # The whole point of caching: the second launch must not re-fetch 9 MB.
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "cache.json"
            path.write_text("{}", encoding="utf-8")
            with mock.patch.object(character_data, "refresh_cache") as refresh:
                self.assertFalse(character_data.ensure_dataset(path=path))
        refresh.assert_not_called()

    def test_a_missing_cache_is_downloaded(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "cache.json"
            with mock.patch.object(
                character_data.urllib.request,
                "urlopen",
                return_value=_response(_big_csv().encode()),
            ):
                self.assertTrue(character_data.ensure_dataset(path=path))
            self.assertTrue(path.is_file())

    def test_a_failed_download_is_not_an_exception(self):
        # This runs on a background thread during startup. Raising would lose the
        # traceback and could take the host down; the studio must work without it.
        import urllib.error

        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "cache.json"
            with mock.patch.object(
                character_data.urllib.request,
                "urlopen",
                side_effect=urllib.error.URLError("offline"),
            ):
                self.assertFalse(character_data.ensure_dataset(path=path))
            self.assertFalse(path.exists())

    def test_an_unexpected_failure_is_also_swallowed(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "cache.json"
            with mock.patch.object(
                character_data, "refresh_cache", side_effect=RuntimeError("unexpected")
            ):
                self.assertFalse(character_data.ensure_dataset(path=path))

    def test_the_background_fetch_starts_only_once(self):
        # Both the extension entry point and the standalone startup hook call this, and
        # a duplicate call must not start a second 9 MB download.
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "cache.json"
            with mock.patch.object(character_data, "ensure_dataset") as fetch, \
                    mock.patch.object(character_data, "warm_index") as warm:
                first = character_data.start_background_fetch(path=path)
                second = character_data.start_background_fetch(path=path)
            self.assertIsNotNone(first)
            self.assertIsNone(second)
            character_data.wait_for_background_fetch(timeout=5)
            self.assertEqual(fetch.call_count + warm.call_count, 2)

    def test_a_current_cache_skips_the_download_but_still_warms(self):
        # `ensure_dataset` returns immediately when the cache is fresh. The thread must
        # still run so the ~1.6 s index build happens at startup rather than on the
        # user's first keystroke, which is the whole point of warming.
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "cache.json"
            path.write_text("{}", encoding="utf-8")
            with mock.patch.object(character_data, "refresh_cache") as refresh:
                thread = character_data.start_background_fetch(path=path)
                self.assertIsNotNone(thread, "the warm-up thread must still start")
                character_data.wait_for_background_fetch(timeout=10)
            refresh.assert_not_called()

    def test_warming_builds_the_index_ahead_of_the_first_search(self):
        # After warming, the first search must not pay the build cost.
        character_data.warm_index()
        self.assertGreater(len(characters.index()), 0)
        # The memo means a second call is free rather than a rebuild.
        self.assertIs(characters.index(), characters.index())

    def test_both_hosts_warm_the_index_at_startup(self):
        # The build costs ~0.9 s for the full catalogue. If a host stops calling this
        # at startup, that cost silently moves onto the user's first keystroke.
        root = Path(__file__).resolve().parents[1]
        extension = (root / "__init__.py").read_text(encoding="utf-8")
        self.assertIn("character_data.start_background_fetch()", extension)

        standalone = (root / "standalone" / "prompt_studio" / "app.py").read_text(encoding="utf-8")
        self.assertIn("character_data.start_background_fetch", standalone)
        self.assertIn("app.on_startup.append", standalone)

    def test_the_warm_thread_never_blocks_its_caller(self):
        # It runs on a thread precisely so a slow or unreachable mirror cannot delay
        # startup; this pins the fact that the call returns promptly.
        import threading as threading_module
        import time

        character_data.reset_startup_state()
        with mock.patch.object(character_data, "ensure_dataset"), \
                mock.patch.object(character_data, "warm_index"):
            started = time.perf_counter()
            thread = character_data.start_background_fetch()
            elapsed = (time.perf_counter() - started) * 1000
        self.assertIsInstance(thread, threading_module.Thread)
        self.assertLess(elapsed, 200, "start_background_fetch must not block on the work")
        character_data.wait_for_background_fetch(timeout=10)

    def test_a_broken_dataset_does_not_break_startup(self):
        # A background thread must never surface a traceback, even if the index cannot
        # be built; the studio runs without characters.
        with mock.patch.object(characters, "index", side_effect=RuntimeError("boom")):
            character_data.warm_index()


class StatusReportingTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.cache = Path(self.folder.name) / "cache.json"
        self.original = character_data.cache_path
        character_data.cache_path = lambda: self.cache
        characters.use_index(None)

    def tearDown(self):
        character_data.cache_path = self.original
        characters.use_index(None)
        self.folder.cleanup()

    def test_a_downloaded_catalogue_is_reported_as_downloaded(self):
        self.cache.write_text(
            character_data.serialize(
                characters.parse_csv(_big_csv()), source="AnimaDex export (characters.csv)"
            ),
            encoding="utf-8",
        )
        status = characters.index_status()
        self.assertTrue(status["downloaded"])
        self.assertFalse(status["bundled_is_sample"])
        self.assertEqual(status["count"], character_data.MIN_CACHEABLE_CHARACTERS + 5)

    def test_an_absent_catalogue_falls_back_to_the_sample_and_says_so(self):
        status = characters.index_status()
        self.assertFalse(status["downloaded"])
        self.assertTrue(status["bundled_is_sample"])
        # The picker needs the URL to explain where the data would come from.
        self.assertTrue(status["dataset_url"].startswith("https://"))

    def test_the_picker_searches_the_downloaded_catalogue(self):
        self.cache.write_text(
            character_data.serialize(characters.parse_csv(_big_csv()), source="test"),
            encoding="utf-8",
        )
        characters.reset_cache()
        # An exact name match ranks first even though a prefix query also matches
        # "character 70", "character 71" and so on.
        self.assertEqual(characters.search("character 7")[0]["character"], "character_7")
        resolved = characters.resolve(["character 7"])
        self.assertEqual(resolved["trigger"], "character 7, series 7")
        self.assertEqual(resolved["unknown"], [])


if __name__ == "__main__":
    unittest.main()
