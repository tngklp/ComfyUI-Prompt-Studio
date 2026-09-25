"""Mode options and media-blind generation.

Two features are covered here.

**Mode options** are per-mode choices declared in ``targets.json`` (Anima's content
rating and prompt style). They change the *content* of the prompt, so they must be
validated against the registry and injected into the request as explicit
instructions rather than being left to the guide to guess.

**Media-blind mode** lets attached media be withheld from the prompt model. The
switch is the user accepting a trade: the reference tags keep working and the brief
keeps its structure, but the model is told it has not seen the media, so nothing
about it may be invented.
"""

import unittest

from backend import targets
from backend.assembly import AssemblyError, assemble_request
from backend.media import MediaStore, build_placeholder
from backend.placeholders import PLACEHOLDER_STATUS
from backend.targets import TargetError


def _assemble(store, session, **body):
    import backend.assembly as assembly

    original = assembly.STORE
    assembly.STORE = store
    try:
        return assemble_request({
            "mode": "AnimaTextToImage",
            "session_id": session,
            "aspect_ratio": "1:1",
            "duration_seconds": 5,
            "creative_brief": "a cat on a fence",
            **body,
        })
    finally:
        assembly.STORE = original


def _user_message(assembled):
    return [message["content"] for message in assembled["messages"] if message["role"] == "user"][-1]


class ModeOptionRegistryTests(unittest.TestCase):
    def test_anima_declares_only_a_style_option(self):
        # The rating option was removed: this target never emits a safety tag, so there
        # is nothing for the user to choose.
        mode = targets.mode("AnimaTextToImage")
        self.assertEqual(mode.option_ids, ("prompt_style",))
        with self.assertRaises(TargetError):
            mode.option("content_rating")

    def test_no_target_declares_a_content_rating(self):
        # A leftover rating option would silently reinstate the safety-tag behaviour.
        for target in targets.targets():
            for mode in target.modes:
                with self.subTest(target=target.id, mode=mode.id):
                    self.assertNotIn("content_rating", mode.option_ids)

    def test_the_style_offers_the_models_three_dialects(self):
        option = targets.mode("AnimaTextToImage").option("prompt_style")
        self.assertEqual(option.choice_ids, ("tags", "natural_language", "hybrid"))
        self.assertEqual(option.default, "tags")

    def test_a_mode_without_options_accepts_none(self):
        self.assertEqual(targets.mode_options("T2VA"), ())
        self.assertEqual(targets.resolve_mode_options("T2VA", None), {})
        with self.assertRaises(TargetError):
            targets.resolve_mode_options("T2VA", {"prompt_style": "tags"})

    def test_an_unknown_option_or_choice_is_rejected(self):
        with self.assertRaises(TargetError) as caught:
            targets.resolve_mode_options("AnimaTextToImage", {"nope": "safe"})
        self.assertEqual(caught.exception.code, "INVALID_OPTION")
        with self.assertRaises(TargetError) as caught:
            targets.resolve_mode_options("AnimaTextToImage", {"prompt_style": "sfw"})
        self.assertEqual(caught.exception.code, "INVALID_OPTION")
        # The removed option must be rejected rather than quietly ignored, so a stale
        # client cannot believe it set a rating.
        with self.assertRaises(TargetError) as caught:
            targets.resolve_mode_options("AnimaTextToImage", {"content_rating": "safe"})
        self.assertEqual(caught.exception.code, "INVALID_OPTION")

    def test_a_non_string_value_is_rejected(self):
        with self.assertRaises(TargetError):
            targets.resolve_mode_options("AnimaTextToImage", {"prompt_style": 3})

    def test_omitted_options_fall_back_to_their_defaults(self):
        resolved = targets.resolve_mode_options("AnimaTextToImage", {})
        self.assertEqual(resolved["prompt_style"], "tags")
        self.assertNotIn("content_rating", resolved)


class ModeOptionAssemblyTests(unittest.TestCase):
    def setUp(self):
        self.store = MediaStore()
        self.session = "44444444-4444-4444-4444-444444444444"

    def test_a_safety_tag_is_never_requested(self):
        # The rating option is gone, so nothing should tell the model to add a tag.
        assembled = _assemble(self.store, self.session)
        message = _user_message(assembled)
        for phrase in ("rated safe", "rated nsfw", "Content rating:"):
            self.assertNotIn(phrase, message)

    def test_the_tags_style_forbids_prose(self):
        assembled = _assemble(self.store, self.session, mode_options={"prompt_style": "tags"})
        message = _user_message(assembled)
        self.assertIn("tags only", message)
        self.assertIn("Do not write prose sentences", message)

    def test_the_natural_language_style_forbids_a_tag_list(self):
        assembled = _assemble(self.store, self.session, mode_options={"prompt_style": "natural_language"})
        message = _user_message(assembled)
        self.assertIn("natural language", message)
        self.assertIn("Do not fall back into a comma-separated tag list", message)

    def test_the_hybrid_style_describes_the_mixture(self):
        assembled = _assemble(self.store, self.session, mode_options={"prompt_style": "hybrid"})
        self.assertIn("hybrid", _user_message(assembled))

    def test_the_resolved_options_are_recorded_on_the_request(self):
        assembled = _assemble(self.store, self.session, mode_options={"prompt_style": "natural_language"})
        self.assertEqual(
            assembled["input"]["mode_options"],
            {"prompt_style": "natural_language"},
        )

    def test_the_final_contract_does_not_contradict_the_chosen_style(self):
        # The strategy's closing line used to tell the model to *choose* a dialect,
        # which fought the style option. It must now defer to the instruction above.
        import backend.targets.anima as anima

        contract = anima.final_contract("AnimaTextToImage", "a brief")
        self.assertIn("using the prompt style stated above", contract)
        self.assertNotIn("Choose one dialect", contract)

    def test_the_audit_accepts_a_prompt_matching_the_selected_style(self):
        import backend.targets.anima as anima

        tag_prompt = "masterpiece, best quality, 1girl, solo, long hair, cityscape, sunset"
        audit = anima.audit_prompt(
            tag_prompt,
            "AnimaTextToImage",
            mode_options={"prompt_style": "tags"},
        )
        self.assertNotIn("the prompt style is Tags but the output is not a tag list", audit["quality_warnings"])

    def test_the_audit_flags_any_safety_tag(self):
        # A safety tag is a defect rather than a preference, whatever the text is, because
        # the user has no way to ask for one. It is reported but not repaired: the tag is
        # stripped from the output instead, which costs nothing, so regenerating the whole
        # prompt for it would be a wasted generation.
        import backend.targets.anima as anima

        for prompt in (
            "masterpiece, best quality, safe, 1girl, solo",
            "masterpiece, best quality, nsfw, 1girl, solo",
            "masterpiece, best quality, sensitive, 1girl, solo",
        ):
            with self.subTest(prompt=prompt):
                audit = anima.audit_prompt(prompt, "AnimaTextToImage")
                self.assertTrue(
                    any("a safety tag was added" in warning for warning in audit["quality_warnings"]),
                    audit["quality_warnings"],
                )
                self.assertFalse(audit["repair_required"])
                # The stripping is what makes the warning safe to leave unrepaired.
                stripped = anima.normalize_prompt_text(prompt)
                self.assertNotIn("safe", stripped)
                self.assertNotIn("nsfw", stripped)
                self.assertNotIn("sensitive", stripped)

    def test_a_clean_prompt_without_a_safety_tag_needs_no_repair_on_that_basis(self):
        import backend.targets.anima as anima

        audit = anima.audit_prompt(
            "masterpiece, best quality, score_7, 1girl, solo, long hair, cityscape",
            "AnimaTextToImage",
            mode_options={"prompt_style": "tags"},
        )
        self.assertFalse(any("a safety tag was added" in warning for warning in audit["quality_warnings"]))

    def test_the_audit_flags_a_style_the_output_did_not_follow(self):
        import backend.targets.anima as anima

        prose = (
            "An anime girl with long silver hair stands on a rooftop at sunset, the wind "
            "lifting her hair as she looks out over the city."
        )
        audit = anima.audit_prompt(
            prose,
            "AnimaTextToImage",
            mode_options={"prompt_style": "tags"},
        )
        self.assertIn("the prompt style is Tags but the output is not a tag list", audit["quality_warnings"])

    def test_an_invalid_option_value_fails_the_assembly(self):
        with self.assertRaises(AssemblyError) as caught:
            _assemble(self.store, self.session, mode_options={"content_rating": "sfw"})
        self.assertEqual(caught.exception.code, "INVALID_OPTION")

    def test_an_option_for_a_mode_that_declares_none_fails_the_assembly(self):
        import backend.assembly as assembly

        original = assembly.STORE
        assembly.STORE = self.store
        try:
            with self.assertRaises(AssemblyError) as caught:
                assemble_request({
                    "mode": "T2VA",
                    "session_id": self.session,
                    "aspect_ratio": "16:9",
                    "duration_seconds": 5,
                    "creative_brief": "a cat",
                    "mode_options": {"content_rating": "safe"},
                })
            self.assertEqual(caught.exception.code, "INVALID_OPTION")
        finally:
            assembly.STORE = original


class BlindMediaAssemblyTests(unittest.TestCase):
    def setUp(self):
        self.store = MediaStore()
        self.session = "55555555-5555-5555-5555-555555555555"

    def _assemble_reference(self, **body):
        import backend.assembly as assembly

        original = assembly.STORE
        assembly.STORE = self.store
        try:
            return assemble_request({
                "mode": "Reference",
                "session_id": self.session,
                "aspect_ratio": "16:9",
                "duration_seconds": 10,
                "creative_brief": "Follow <Picture 1> for the subject.",
                **body,
            })
        finally:
            assembly.STORE = original

    def _add_placeholder(self, kind="image", description="a red bicycle"):
        return self.store.commit_placeholder(
            self.session, "Reference", build_placeholder(self.session, "Reference", kind, description)
        )

    def test_a_declared_slot_is_withheld_from_the_model(self):
        self._add_placeholder()
        assembled = self._assemble_reference()
        message = _user_message(assembled)
        self.assertIn("no image attached", message)
        self.assertIn("a red bicycle", message)
        self.assertEqual(assembled["media_inputs"], [])

    def test_blind_mode_keeps_the_reference_tag_valid(self):
        # The attached asset is withheld, but its tag must still resolve in the
        # brief - that is what makes blind mode usable at all.
        self._add_placeholder()
        assembled = self._assemble_reference(blind_media=True)
        self.assertEqual(assembled["input"]["blind_media"], True)

    def test_blind_mode_records_the_flag_on_the_request(self):
        self._add_placeholder()
        self.assertEqual(self._assemble_reference()["input"]["blind_media"], False)
        self.assertEqual(self._assemble_reference(blind_media=True)["input"]["blind_media"], True)

    def test_the_flag_must_be_a_real_boolean(self):
        # A truthy string must not silently enable it: the setting changes what the
        # model is shown, so only an explicit `true` counts.
        self._add_placeholder()
        assembled = self._assemble_reference(blind_media="yes")
        self.assertEqual(assembled["input"]["blind_media"], False)


class BlindMediaGateTests(unittest.TestCase):
    """The vision gate must allow a text-only model when nothing is really sent."""

    def test_a_withheld_attachment_does_not_require_vision(self):
        from backend.pipeline import validate_media_capabilities

        assembled = {
            "media_inputs": [],
            "input": {"mode": "Reference", "blind_media": True},
            "messages": [],
        }
        # Must not raise.
        validate_media_capabilities({"family": "gguf", "capabilities": {"images": False}}, assembled)

    def test_a_real_attachment_still_requires_vision(self):
        from backend.models.contract import ModelError
        from backend.pipeline import validate_media_capabilities

        assembled = {
            "media_inputs": [{
                "asset_id": "real",
                "reference": "<Picture 1>",
                "type": "image",
                "requires_capability": "images",
            }],
            "input": {"mode": "Reference", "blind_media": False},
            "messages": [],
        }
        with self.assertRaises(ModelError) as caught:
            validate_media_capabilities({"family": "gguf", "capabilities": {"images": False}}, assembled)
        self.assertEqual(caught.exception.code, "DIRECT_VISION_REQUIRED")
        # The suggestion must mention the switch, or the user has no way out.
        self.assertIn("Media-blind mode", caught.exception.details["suggestion"])


if __name__ == "__main__":
    unittest.main()
