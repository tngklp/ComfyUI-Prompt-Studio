"""Anima character references and the Anima tag-region highlighting contract.

The character feature exists because Anima needs a character named with its exact
Danbooru spelling *and* its series - ``hatsune miku, vocaloid``. The user's mental
model of the name is usually shorter than the slug, so ``miku`` must resolve even
though no character is literally called that.

Two properties matter most and are pinned hardest here:

1. an ambiguous short name resolves to **nothing** rather than to a guess, because a
   silently wrong character in the prompt is worse than no character; and
2. a resolved trigger reaches the prompt verbatim, positioned by the guide's tag order.
"""

import json
import unittest
from pathlib import Path

from backend import characters
from backend.assembly import assemble_request
from backend.media import MediaStore

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "backend" / "data" / "anima_characters.json"

# A small CSV in the AnimaDex shape, including a deliberately ambiguous pair.
SAMPLE_CSV = """character,copyright,trigger,core_tags,count,url
hatsune_miku,vocaloid,"hatsune miku, vocaloid","1girl, aqua eyes, twintails",103500,https://danbooru.donmai.us/posts?tags=hatsune_miku
hakurei_reimu,touhou,"hakurei reimu, touhou","1girl, brown eyes, hair bow",78109,https://danbooru.donmai.us/posts?tags=hakurei_reimu
kirisame_marisa,touhou,"kirisame marisa, touhou","1girl, blonde hair, witch hat",70313,https://danbooru.donmai.us/posts?tags=kirisame_marisa
artoria_pendragon_(fate),fate_(series),"artoria pendragon (fate), fate (series)","1girl, blonde hair, ahoge",37549,https://danbooru.donmai.us/posts?tags=artoria_pendragon_%28fate%29
hakurei_miko,touhou,"hakurei miko, touhou","1girl, red hair",10,https://danbooru.donmai.us/posts?tags=hakurei_miko
"""


def _index(text=SAMPLE_CSV) -> characters.CharacterIndex:
    return characters.CharacterIndex(characters.parse_csv(text))


class CharacterParsingTests(unittest.TestCase):
    def test_a_csv_row_becomes_a_character_with_its_trigger(self):
        entries = characters.parse_csv(SAMPLE_CSV)
        miku = next(entry for entry in entries if entry.character == "hatsune_miku")
        self.assertEqual(miku.trigger, "hatsune miku, vocaloid")
        self.assertEqual(miku.copyright, "vocaloid")
        self.assertEqual(miku.count, 103500)

    def test_entries_are_ordered_most_used_first(self):
        entries = characters.parse_csv(SAMPLE_CSV)
        counts = [entry.count for entry in entries]
        self.assertEqual(counts, sorted(counts, reverse=True))
        self.assertEqual(entries[0].character, "hatsune_miku")

    def test_the_trigger_is_split_into_character_and_series(self):
        self.assertEqual(characters.parse_trigger("hatsune miku, vocaloid"), ("hatsune miku", "vocaloid", ()))
        self.assertEqual(characters.parse_trigger("solo"), ("solo", "", ()))
        self.assertEqual(characters.parse_trigger(""), ("", "", ()))

    def test_a_csv_without_a_character_column_is_rejected(self):
        with self.assertRaises(characters.CharacterIndexError) as caught:
            characters.parse_csv("name,series\nfoo,bar\n")
        self.assertEqual(caught.exception.code, "CHARACTER_CSV_INVALID")

    def test_an_empty_csv_is_rejected(self):
        with self.assertRaises(characters.CharacterIndexError) as caught:
            characters.parse_csv("character,copyright,trigger\n")
        self.assertEqual(caught.exception.code, "CHARACTER_CSV_EMPTY")

    def test_a_bom_does_not_break_the_header(self):
        # Excel and some exporters prepend a UTF-8 BOM, which would otherwise make the
        # first column name "﻿character" and fail the header check.
        entries = characters.parse_csv("\ufeff" + SAMPLE_CSV)
        self.assertTrue(any(entry.character == "hatsune_miku" for entry in entries))

    def test_count_tags_are_never_treated_as_characters(self):
        csv_text = (
            "character,copyright,trigger,core_tags,count,url\n"
            '1girl,,"1girl" ,"",5,\n'
            "hatsune_miku,vocaloid,\"hatsune miku, vocaloid\",,10,\n"
        )
        entries = characters.parse_csv(csv_text)
        self.assertEqual([entry.character for entry in entries], ["hatsune_miku"])

    def test_an_overlong_trigger_is_dropped(self):
        # A trigger that long is not a real character, and it would waste prompt
        # budget. Dropping the only row leaves nothing usable, which is an error
        # rather than an empty index: the import is rejected so the user can tell
        # their file was not what the loader expects.
        csv_text = f'character,copyright,trigger,core_tags,count,url\nfoo,bar,"{("x" * 200)}",,1,\n'
        with self.assertRaises(characters.CharacterIndexError) as caught:
            characters.parse_csv(csv_text)
        self.assertEqual(caught.exception.code, "CHARACTER_CSV_EMPTY")

    def test_an_overlong_row_is_dropped_while_good_rows_survive(self):
        csv_text = (
            "character,copyright,trigger,core_tags,count,url\n"
            f'foo,bar,"{("x" * 200)}",,1,\n'
            'hatsune_miku,vocaloid,"hatsune miku, vocaloid",,10,\n'
        )
        self.assertEqual([entry.character for entry in characters.parse_csv(csv_text)], ["hatsune_miku"])


class CharacterLookupTests(unittest.TestCase):
    def setUp(self):
        self.index = _index()

    def test_a_short_name_resolves_to_the_full_trigger(self):
        # The user's own example: typing "miku" must find hatsune miku.
        self.assertEqual(self.index.lookup("miku").trigger, "hatsune miku, vocaloid")
        self.assertEqual(self.index.lookup("Miku").trigger, "hatsune miku, vocaloid")

    def test_the_exact_name_and_the_full_trigger_both_resolve(self):
        for query in ("hatsune miku", "Hatsune_Miku", "hatsune_miku", "hatsune miku, vocaloid"):
            with self.subTest(query=query):
                self.assertEqual(self.index.lookup(query).trigger, "hatsune miku, vocaloid")

    def test_an_ambiguous_short_name_resolves_to_nothing(self):
        # Two characters end in different words, but "reimu" is unique while a shared
        # tail would be ambiguous. Build that case explicitly.
        csv_text = (
            "character,copyright,trigger,core_tags,count,url\n"
            'alpha_miku,vocaloid,"alpha miku, vocaloid",,10,\n'
            'beta_miku,vocaloid,"beta miku, vocaloid",,9,\n'
        )
        index = _index(csv_text)
        self.assertIsNone(index.lookup("miku"), "an ambiguous tail must not be guessed")

    def test_an_unknown_name_resolves_to_nothing(self):
        self.assertIsNone(self.index.lookup("definitely not a character"))
        self.assertIsNone(self.index.lookup(""))
        self.assertIsNone(self.index.lookup(None))

    def test_punctuation_does_not_prevent_a_match(self):
        # "artoria pendragon (fate)" must be reachable without the parentheses.
        self.assertEqual(self.index.lookup("artoria pendragon").character, "artoria_pendragon_(fate)")
        self.assertEqual(self.index.lookup("artoria pendragon fate").character, "artoria_pendragon_(fate)")

    def test_a_whole_word_inside_a_name_resolves_when_unique(self):
        self.assertEqual(self.index.lookup("marisa").character, "kirisame_marisa")

    def test_search_ranks_an_exact_name_first(self):
        results = self.index.search("hakurei reimu")
        self.assertTrue(results)
        self.assertEqual(results[0].character, "hakurei_reimu")

    def test_search_prefers_the_more_used_character_within_a_tier(self):
        results = self.index.search("hakurei")
        self.assertEqual([entry.character for entry in results][:2], ["hakurei_reimu", "hakurei_miko"])

    def test_search_finds_a_character_by_series(self):
        results = self.index.search("vocaloid")
        self.assertIn("hatsune_miku", [entry.character for entry in results])

    def test_search_returns_nothing_for_an_empty_query(self):
        self.assertEqual(self.index.search(""), [])
        self.assertEqual(self.index.search("   "), [])

    def test_search_respects_its_limit(self):
        self.assertEqual(len(self.index.search("touhou", 1)), 1)

    def test_resolve_many_preserves_order_and_drops_duplicates(self):
        found, unknown = self.index.resolve_many(["miku", "reimu", "miku"])
        self.assertEqual([entry.character for entry in found], ["hatsune_miku", "hakurei_reimu"])
        self.assertEqual(unknown, [])

    def test_resolve_many_reports_unknown_names(self):
        found, unknown = self.index.resolve_many(["miku", "nobody"])
        self.assertEqual([entry.character for entry in found], ["hatsune_miku"])
        self.assertEqual(unknown, ["nobody"])


class CharacterIndexFileTests(unittest.TestCase):
    def test_the_bundled_index_file_is_valid_and_shaped_correctly(self):
        raw = json.loads(DATA_PATH.read_text(encoding="utf-8"))
        self.assertIn("characters", raw)
        self.assertIn("source", raw)
        for row in raw["characters"]:
            self.assertIn("character", row)
            self.assertIn("trigger", row)
            self.assertTrue(row["trigger"].strip(), row)

    def test_a_missing_data_file_degrades_to_an_empty_index(self):
        # A broken data file must never stop the studio loading.
        index = characters.load_builtin(Path("does-not-exist.json"))
        self.assertEqual(len(index), 0)
        self.assertIsNone(index.lookup("miku"))

    def test_a_corrupt_data_file_degrades_to_an_empty_index(self):
        import tempfile

        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "broken.json"
            path.write_text("{not json", encoding="utf-8")
            self.assertEqual(len(characters.load_builtin(path)), 0)

    def test_the_active_index_reports_that_the_sample_is_only_a_sample(self):
        # A developer's checkout legitimately has a downloaded cache, so this pins the
        # rule (the committed fallback is a sample and says so) against the committed
        # file rather than against whatever the local cache happens to be.
        status = characters.index_status()
        if status["downloaded"]:
            self.skipTest("a downloaded dataset cache is present on this machine")
        self.assertTrue(status["bundled_is_sample"])
        self.assertLess(status["count"], characters.BUNDLED_USEFUL_THRESHOLD)

    def test_the_dataset_url_is_published_for_the_interface(self):
        # Settings shows the user where the data comes from, so the URL has to travel
        # with the status rather than being duplicated in JavaScript.
        self.assertEqual(
            characters.index_status()["dataset_url"],
            "https://blobs.animadex.net/export/characters.csv",
        )


class CharacterIndexSelectionTests(unittest.TestCase):
    """The index resolves override -> downloaded cache -> shipped sample."""

    def tearDown(self):
        characters.use_index(None)

    def test_an_override_takes_precedence(self):
        characters.use_index(_index())
        self.assertEqual(len(characters.index()), 5)
        self.assertEqual(characters.index().lookup("miku").trigger, "hatsune miku, vocaloid")
        self.assertEqual(characters.index_status()["count"], 5)

    def test_clearing_the_override_falls_back_to_the_next_source(self):
        characters.use_index(_index())
        characters.use_index(None)
        # Whatever the fallback is, it is no longer the override's 5-row fixture.
        self.assertNotEqual(characters.index_status()["count"], 5)

    def test_the_shipped_sample_is_used_when_no_cache_exists(self):
        # An offline first launch must still give a working picker.
        characters.use_index(None)
        status = characters.index_status()
        if status["downloaded"]:
            self.skipTest("a downloaded dataset cache is present on this machine")
        self.assertEqual(status["count"], len(characters.load_builtin()))


class CharacterDirectiveTests(unittest.TestCase):
    """The trigger has to reach the prompt in the right place, spelled exactly."""

    def setUp(self):
        self.store = MediaStore()
        self.session = "88888888-8888-8888-8888-888888888888"
        characters.use_index(_index())

    def tearDown(self):
        characters.use_index(None)

    def _assemble(self, **body):
        import backend.assembly as assembly

        original = assembly.STORE
        assembly.STORE = self.store
        try:
            return assemble_request({
                "mode": "AnimaTextToImage",
                "session_id": self.session,
                "aspect_ratio": "1:1",
                "duration_seconds": 5,
                "creative_brief": "miku on a rooftop",
                **body,
            })
        finally:
            assembly.STORE = original

    @staticmethod
    def _user_message(assembled):
        return [m["content"] for m in assembled["messages"] if m["role"] == "user"][-1]

    def test_a_short_name_becomes_its_exact_trigger(self):
        assembled = self._assemble(characters=["miku"])
        self.assertIn("hatsune miku, vocaloid", self._user_message(assembled))

    def test_the_resolved_slug_is_recorded_on_the_request(self):
        assembled = self._assemble(characters=["miku", "Reimu"])
        self.assertEqual(assembled["input"]["characters"], ["hatsune_miku", "hakurei_reimu"])

    def test_the_directive_states_the_tag_order_position(self):
        message = self._user_message(self._assemble(characters=["miku"]))
        # The guide places a character and its series between the count tag and the
        # artist tags; saying so is the whole reason the directive exists.
        self.assertIn("between the subject count tag and the artist tags", message)
        self.assertIn("Do not rename them", message)
        self.assertIn("do not reorder the character before its series", message)

    def test_an_unknown_name_is_called_out_and_not_invented(self):
        message = self._user_message(self._assemble(characters=["miku", "somebody unknown"]))
        self.assertIn("somebody unknown", message)
        self.assertIn("leave them out", message)

    def test_no_selection_adds_no_directive(self):
        message = self._user_message(self._assemble())
        self.assertNotIn("Characters: the prompt must include", message)

    def test_a_non_list_selection_is_ignored(self):
        assembled = self._assemble(characters="miku")
        self.assertEqual(assembled["input"]["characters"], [])

    def test_the_directive_comes_after_the_style_instruction(self):
        # The style sets the dialect, so it must be read before the characters are
        # placed. Reversing them would let "tags only" overwrite the placement rule.
        message = self._user_message(self._assemble(
            characters=["miku"],
            mode_options={"prompt_style": "tags"},
        ))
        self.assertLess(
            message.index("Prompt style:"),
            message.index("Characters: the prompt must include"),
        )

    def test_selected_characters_survive_alongside_other_modes(self):
        # A target whose mode declares no options and no characters must be unaffected.
        import backend.assembly as assembly

        original = assembly.STORE
        assembly.STORE = self.store
        try:
            assembled = assemble_request({
                "mode": "T2VA",
                "session_id": self.session,
                "aspect_ratio": "16:9",
                "duration_seconds": 10,
                "creative_brief": "a cat",
                "characters": ["miku"],
            })
        finally:
            assembly.STORE = original
        # The directive is written for Anima's guide, so a video target must not get it.
        message = [m["content"] for m in assembled["messages"] if m["role"] == "user"][-1]
        self.assertNotIn("Characters: the prompt must include", message)


class CharacterDataIntegrityTests(unittest.TestCase):
    def test_the_shipped_sample_matches_the_loader_shape(self):
        # The committed fallback is consumed by load_builtin; a field it omits would
        # silently produce an entry with no trigger.
        raw = json.loads(DATA_PATH.read_text(encoding="utf-8"))
        for row in raw["characters"]:
            entry = characters.CharacterRef(
                character=row["character"],
                copyright=row.get("copyright", ""),
                trigger=row["trigger"],
                count=int(row.get("count", 0)),
            )
            self.assertTrue(entry.trigger.strip())
            self.assertIn(",", entry.trigger, f"{entry.character} has no series in its trigger")

    def test_the_shipped_sample_stays_small(self):
        # The whole point of not shipping the catalogue is that the package stays
        # small. A committed file near the full dataset size means someone re-added it.
        self.assertLess(DATA_PATH.stat().st_size, 64 * 1024)

    def test_the_cache_is_not_shipped(self):
        # The downloaded index is gitignored. A tracked copy would go stale silently
        # and would mean the package had grown by 4 MB. This checks the rule, not the
        # developer's local disk: a working checkout legitimately has a cache present.
        ignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
        self.assertIn("backend/data/anima_characters.cache.json", ignore)

    def test_the_cache_is_not_tracked_by_git(self):
        import subprocess

        completed = subprocess.run(
            ["git", "ls-files", "--error-unmatch", "backend/data/anima_characters.cache.json"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(completed.returncode, 0, "the dataset cache must not be tracked")

    def test_no_import_of_a_local_csv_survives(self):
        # The user-facing import was removed in favour of the automatic download. A
        # leftover route would be dead code pointing at a deleted module function.
        for relative in ("web/settings.js", "web/main.js", "web/api/prompt_studio.js"):
            source = (ROOT / relative).read_text(encoding="utf-8")
            # The hooks, not the CSS class: the card keeps its styling class, but the
            # data attributes and API calls that drove the file picker must be gone.
            for hook in ("data-character-import", "data-character-clear-import"):
                self.assertNotIn(hook, source, f"{relative} still has {hook}")
            for call in ("importCharacters", "clearCharacters", "clearCharacterImport", "importCharacterCsv"):
                self.assertNotIn(call, source, f"{relative} still calls {call}")
        routes = (ROOT / "backend" / "routes.py").read_text(encoding="utf-8")
        self.assertNotIn("characters/import", routes)

    def test_settings_has_no_character_section(self):
        # The dataset is fetched automatically, so there is nothing for the user to
        # configure and no reason to show them its state.
        source = (ROOT / "web" / "settings.js").read_text(encoding="utf-8")
        for hook in ("data-character-source", "data-character-refresh", "ps-character-settings"):
            self.assertNotIn(hook, source, f"settings.js still has {hook}")

    def test_there_is_no_manual_refresh_path(self):
        # The download is unambiguously automatic: no route, no client call, and no
        # download handler in the interface.
        routes = (ROOT / "backend" / "routes.py").read_text(encoding="utf-8")
        self.assertNotIn("characters/refresh", routes)
        api = (ROOT / "web" / "api" / "prompt_studio.js").read_text(encoding="utf-8")
        self.assertNotIn("refreshCharacters", api)
        main = (ROOT / "web" / "main.js").read_text(encoding="utf-8")
        self.assertNotIn("downloadCharacterDataset", main)
        self.assertNotIn("refreshCharacters", main)


if __name__ == "__main__":
    unittest.main()
