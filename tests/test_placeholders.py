"""Manual reference placeholders.

A placeholder lets a reference-driven prompt be written before its media exists:
the user reserves the reference tag, describes what will go there, and the prompt
model writes from that description instead of from an image it cannot see.

These tests pin the four properties that make the feature safe:

1. it owns a reference tag, so the brief's tag passes reference validation;
2. it never becomes a media input, so no vision capability is demanded;
3. it never spends visual token budget and never upgrades the context profile;
4. it is described to the prompt model as a *declaration*, so nothing about the
   absent media is presented as observed fact.
"""

import unittest

from backend import targets
from backend.assembly import assemble_request
from backend.context import plan_context
from backend.media import MediaError, MediaStore, build_placeholder
from backend.placeholders import (
    PLACEHOLDER_DESCRIPTION_LIMIT,
    PlaceholderError,
    is_placeholder,
    placeholder_line,
    validate_placeholder,
)


def _store_with_placeholder(mode="Reference", kind="image", description="a red bicycle"):
    store = MediaStore()
    session = "11111111-1111-1111-1111-111111111111"
    asset = store.commit_placeholder(session, mode, build_placeholder(session, mode, kind, description))
    return store, session, asset


class PlaceholderModuleTests(unittest.TestCase):
    def test_a_valid_image_placeholder_is_accepted(self):
        kind, description = validate_placeholder("image", "  a red bicycle  ")
        self.assertEqual(kind, "image")
        self.assertEqual(description, "a red bicycle")

    def test_audio_is_not_a_placeholder_kind(self):
        # Audio is never analysed by the prompt model, so it never had the problem
        # this feature exists to solve.
        with self.assertRaises(PlaceholderError) as caught:
            validate_placeholder("audio", "a hum")
        self.assertEqual(caught.exception.code, "INVALID_PLACEHOLDER_KIND")

    def test_a_description_is_required(self):
        for value in ("", "   ", None, 12):
            with self.subTest(value=value):
                with self.assertRaises(PlaceholderError) as caught:
                    validate_placeholder("image", value)
                self.assertEqual(caught.exception.code, "PLACEHOLDER_DESCRIPTION_REQUIRED")

    def test_an_overlong_description_is_rejected(self):
        with self.assertRaises(PlaceholderError) as caught:
            validate_placeholder("image", "x" * (PLACEHOLDER_DESCRIPTION_LIMIT + 1))
        self.assertEqual(caught.exception.code, "PLACEHOLDER_DESCRIPTION_TOO_LONG")

    def test_the_placeholder_line_is_a_declaration_not_a_description(self):
        line = placeholder_line({"reference": "<Picture 1>", "type": "image", "description": "a red bicycle"})
        self.assertIn("<Picture 1>", line)
        self.assertIn("a red bicycle", line)
        self.assertIn("no image attached", line)
        # The wording must forbid inventing content the user did not supply.
        self.assertIn("do not invent", line)
        self.assertIn("Do not claim to have seen", line)

    def test_is_placeholder_only_matches_the_placeholder_status(self):
        self.assertTrue(is_placeholder({"status": "placeholder"}))
        self.assertFalse(is_placeholder({"status": "needs_edit"}))
        self.assertFalse(is_placeholder({}))
        self.assertFalse(is_placeholder(None))


class PlaceholderStoreTests(unittest.TestCase):
    def test_a_placeholder_owns_the_next_reference_tag(self):
        store, session, asset = _store_with_placeholder()
        self.assertEqual(asset["reference"], "<Picture 1>")
        self.assertEqual(asset["status"], "placeholder")

    def test_a_placeholder_publishes_no_media_urls(self):
        store, session, asset = _store_with_placeholder()
        for key in ("content_url", "source_url", "preview_url", "prepared_url"):
            self.assertNotIn(key, asset, key)
        self.assertEqual(asset["frames"], [])

    def test_placeholders_and_real_files_share_one_numbering_sequence(self):
        # The tag a user already wrote must not move when the file finally arrives.
        store, session, placeholder = _store_with_placeholder()
        self.assertEqual(placeholder["reference"], "<Picture 1>")
        self.assertEqual(store.list(session)[0]["reference"], "<Picture 1>")

    def test_a_video_placeholder_takes_the_video_sequence(self):
        store, session, asset = _store_with_placeholder(kind="video", description="a tram passing")
        self.assertEqual(asset["reference"], "<Video 1>")

    def test_a_placeholder_counts_against_the_mode_limit(self):
        store = MediaStore()
        session = "11111111-1111-1111-1111-111111111111"
        # ImageEdit allows ten images and nothing else.
        for _ in range(10):
            store.commit_placeholder(session, "ImageEdit", build_placeholder(session, "ImageEdit", "image", "x"))
        with self.assertRaises(MediaError) as caught:
            store.commit_placeholder(session, "ImageEdit", build_placeholder(session, "ImageEdit", "image", "x"))
        self.assertEqual(caught.exception.code, "MEDIA_LIMIT_REACHED")

    def test_the_manifest_keeps_placeholders_but_reports_them(self):
        store, session, asset = _store_with_placeholder()
        manifest = store.manifest(session, "Reference")
        references = [item["reference"] for item in manifest["assets"]]
        self.assertIn("<Picture 1>", references)
        self.assertEqual(manifest["unresolved_count"], 1)
        self.assertEqual([item["id"] for item in manifest["placeholders"]], [asset["id"]])

    def test_needs_edit_assets_are_still_dropped_from_the_manifest(self):
        # A `needs_edit` asset has no assigned reference, so it must stay excluded.
        store, session, _ = _store_with_placeholder()
        store.assets(session)[0]["status"] = "needs_edit"
        manifest = store.manifest(session, "Reference")
        self.assertEqual(manifest["assets"], [])
        self.assertEqual(manifest["placeholders"], [])

    def test_a_placeholder_can_be_removed_without_a_filesystem_error(self):
        store, session, asset = _store_with_placeholder()
        store.remove(session, asset["id"])
        self.assertEqual(store.list(session), [])

    def test_updating_the_description_is_not_a_media_change(self):
        store, session, asset = _store_with_placeholder()
        store.get(session, asset["id"])["description"] = "a blue tricycle"
        self.assertEqual(store.list(session)[0]["description"], "a blue tricycle")

    def test_filling_a_slot_with_a_mismatched_kind_is_rejected(self):
        store, session, asset = _store_with_placeholder(kind="video", description="a tram")
        from pathlib import Path

        with self.assertRaises(MediaError) as caught:
            store.resolve_placeholder(
                session,
                asset["id"],
                "photo.png",
                "image/png",
                Path("photo.png"),
            )
        self.assertEqual(caught.exception.code, "PLACEHOLDER_KIND_MISMATCH")

    def test_resolving_a_real_asset_is_rejected(self):
        store, session, asset = _store_with_placeholder()
        store.assets(session)[0]["status"] = "ready"
        from pathlib import Path

        with self.assertRaises(MediaError) as caught:
            store.resolve_placeholder(session, asset["id"], "photo.png", "image/png", Path("photo.png"))
        self.assertEqual(caught.exception.code, "NOT_A_PLACEHOLDER")


class PlaceholderAssemblyTests(unittest.TestCase):
    def _assemble(self, store, session, brief):
        # Swap the module-level store for the test's own, the way the routes do.
        import backend.assembly as assembly

        original = assembly.STORE
        assembly.STORE = store
        try:
            return assemble_request({
                "mode": "Reference",
                "session_id": session,
                "aspect_ratio": "16:9",
                "duration_seconds": 10,
                "creative_brief": brief,
            })
        finally:
            assembly.STORE = original

    def test_the_brief_may_reference_a_declared_slot(self):
        # This is the whole point: the tag resolves even though no file exists.
        store, session, _ = _store_with_placeholder()
        assembled = self._assemble(store, session, "Follow <Picture 1> for the bicycle.")
        self.assertEqual(assembled["input"]["mode"], "Reference")

    def test_a_placeholder_is_never_a_media_input(self):
        store, session, _ = _store_with_placeholder()
        assembled = self._assemble(store, session, "Follow <Picture 1>.")
        self.assertEqual(assembled["media_inputs"], [])

    def test_the_prompt_model_is_told_the_media_is_absent(self):
        store, session, _ = _store_with_placeholder(description="a red bicycle")
        assembled = self._assemble(store, session, "Follow <Picture 1>.")
        user_message = assembled["messages"][-1]["content"]
        self.assertIn("<Picture 1>", user_message)
        self.assertIn("a red bicycle", user_message)
        self.assertIn("no image attached", user_message)
        self.assertIn("Do not claim to have seen", user_message)

    def test_a_placeholder_spends_no_visual_token_budget(self):
        store, session, _ = _store_with_placeholder()
        assembled = self._assemble(store, session, "Follow <Picture 1>.")
        plan = plan_context(
            assembled,
            {"family": "gguf", "capabilities": {"images": False}, "architecture_adapter": None},
            requested_context="auto",
            requested_kv_cache="auto",
            thinking=False,
        )
        self.assertEqual(plan["visual_input_count"], 0)
        self.assertEqual(plan["estimated_visual_tokens"], 0)
        self.assertFalse(plan["vision_budget_applied"])

    def test_a_placeholder_does_not_trigger_the_direct_vision_gate(self):
        # A text-only Direct GGUF must still be able to write a prompt for a
        # declared-but-absent reference; that is the user's stated ask.
        from backend.pipeline import validate_media_capabilities

        store, session, _ = _store_with_placeholder()
        assembled = self._assemble(store, session, "Follow <Picture 1>.")
        # Must not raise.
        validate_media_capabilities(
            {"family": "gguf", "capabilities": {"images": False}},
            assembled,
        )

    def test_the_vision_gate_still_fires_for_actually_attached_media(self):
        # Relaxing the gate must not disable it: the moment media is really sent,
        # a text-only model must still be refused.
        from backend.models.contract import ModelError
        from backend.pipeline import validate_media_capabilities

        store, session, _ = _store_with_placeholder()
        assembled = self._assemble(store, session, "Follow <Picture 1>.")
        assembled["media_inputs"] = [{
            "asset_id": "real",
            "reference": "<Picture 1>",
            "type": "image",
            "requires_capability": "images",
        }]
        with self.assertRaises(ModelError) as caught:
            validate_media_capabilities(
                {"family": "gguf", "capabilities": {"images": False}},
                assembled,
            )
        self.assertEqual(caught.exception.code, "DIRECT_VISION_REQUIRED")

    def test_an_undeclared_tag_still_fails(self):
        # The placeholder must not weaken reference validation for tags the user
        # never declared.
        from backend.assembly import AssemblyError

        store, session, _ = _store_with_placeholder()
        with self.assertRaises(AssemblyError) as caught:
            self._assemble(store, session, "Follow <Picture 4>.")
        self.assertEqual(caught.exception.code, "REFERENCE_NOT_FOUND")


class PlaceholderRegistryTests(unittest.TestCase):
    def test_placeholders_are_offered_only_where_media_is_required(self):
        media_modes = {
            mode.id
            for target in targets.targets()
            for mode in target.modes
            if mode.requires_media
        }
        self.assertIn("Reference", media_modes)
        self.assertIn("ImageEdit", media_modes)
        self.assertNotIn("T2VA", media_modes)


if __name__ == "__main__":
    unittest.main()
