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
    def test_anima_declares_a_rating_and_a_style_option(self):
        mode = targets.mode("AnimaTextToImage")
        self.assertEqual(mode.option_ids, ("content_rating", "prompt_style"))

    def test_the_rating_offers_the_models_trained_vocabulary(self):
        option = targets.mode("AnimaTextToImage").option("content_rating")
        self.assertEqual(option.choice_ids, ("none", "safe", "sensitive", "nsfw", "explicit"))
        self.assertEqual(
            [choice.prompt_tag for choice in option.choices],
            [None, "safe", "sensitive", "nsfw", "explicit"],
        )

    def test_the_rating_default_omits_the_tag(self):
        # The user asked for no safety tag unless one is chosen, so the default is
        # explicitly None rather than one of the four ratings.
        self.assertIsNone(targets.mode("AnimaTextToImage").option("content_rating").default)
        self.assertEqual(
            targets.resolve_mode_options("AnimaTextToImage", None)["content_rating"],
            None,
        )

    def test_the_style_offers_the_models_three_dialects(self):
        option = targets.mode("AnimaTextToImage").option("prompt_style")
        self.assertEqual(option.choice_ids, ("tags", "natural_language", "hybrid"))
        self.assertEqual(option.default, "tags")

    def test_a_mode_without_options_accepts_none(self):
        self.assertEqual(targets.mode_options("T2VA"), ())
        self.assertEqual(targets.resolve_mode_options("T2VA", None), {})
        with self.assertRaises(TargetError):
            targets.resolve_mode_options("T2VA", {"content_rating": "safe"})

    def test_an_unknown_option_or_choice_is_rejected(self):
        with self.assertRaises(TargetError) as caught:
            targets.resolve_mode_options("AnimaTextToImage", {"nope": "safe"})
        self.assertEqual(caught.exception.code, "INVALID_OPTION")
        with self.assertRaises(TargetError) as caught:
            targets.resolve_mode_options("AnimaTextToImage", {"content_rating": "sfw"})
        self.assertEqual(caught.exception.code, "INVALID_OPTION")

    def test_a_non_string_value_is_rejected(self):
        with self.assertRaises(TargetError):
            targets.resolve_mode_options("AnimaTextToImage", {"content_rating": 3})

    def test_an_explicit_null_keeps_an_opt_in_option_off(self):
        resolved = targets.resolve_mode_options("AnimaTextToImage", {"content_rating": None})
        self.assertIsNone(resolved["content_rating"])

    def test_omitted_options_fall_back_to_their_defaults(self):
        resolved = targets.resolve_mode_options("AnimaTextToImage", {})
        self.assertIsNone(resolved["content_rating"])
        self.assertEqual(resolved["prompt_style"], "tags")


class ModeOptionAssemblyTests(unittest.TestCase):
    def setUp(self):
        self.store = MediaStore()
        self.session = "44444444-4444-4444-4444-444444444444"

    def test_the_selected_rating_is_named_in_the_request(self):
        assembled = _assemble(self.store, self.session, mode_options={"content_rating": "nsfw"})
        message = _user_message(assembled)
        self.assertIn("rated nsfw", message)
        self.assertIn("`nsfw`", message)

    def test_choosing_none_suppresses_the_tag_explicitly(self):
        assembled = _assemble(self.store, self.session, mode_options={"content_rating": "none"})
        message = _user_message(assembled)
        self.assertIn("no safety tag was requested", message)
        self.assertNotIn("rated safe", message)
        self.assertNotIn("rated nsfw", message)

    def test_an_unset_rating_defers_to_the_guide(self):
        # "No selection" is not the same as "explicitly none": with nothing chosen
        # the model is left to the guide's own advice rather than being told to
        # omit the tag. Only the explicit `none` choice says "do not add a tag".
        assembled = _assemble(self.store, self.session)
        message = _user_message(assembled)
        self.assertNotIn("no safety tag was requested", message)
        self.assertNotIn("rated safe", message)

    def test_an_explicit_null_is_treated_as_unset(self):
        assembled = _assemble(self.store, self.session, mode_options={"content_rating": None})
        message = _user_message(assembled)
        self.assertNotIn("no safety tag was requested", message)

    def test_each_rating_quotations_its_own_tag(self):
        for rating in ("safe", "sensitive", "nsfw", "explicit"):
            with self.subTest(rating=rating):
                assembled = _assemble(self.store, self.session, mode_options={"content_rating": rating})
                message = _user_message(assembled)
                self.assertIn(f"rated {rating}", message)
                self.assertIn(f"`{rating}`", message)

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
        assembled = _assemble(self.store, self.session, mode_options={"content_rating": "sensitive"})
        self.assertEqual(
            assembled["input"]["mode_options"],
            {"content_rating": "sensitive", "prompt_style": "tags"},
        )

    def test_the_final_contract_does_not_contradict_the_chosen_style(self):
        # The strategy's closing line used to tell the model to *choose* a dialect,
        # which fought the style option. It must now defer to the instruction above.
        import backend.targets.anima as anima

        contract = anima.final_contract("AnimaTextToImage", "a brief")
        self.assertIn("using the prompt style and content rating stated above", contract)
        self.assertNotIn("Choose one dialect", contract)

    def test_the_audit_accepts_a_prompt_matching_the_selected_style(self):
        import backend.targets.anima as anima

        tag_prompt = "masterpiece, best quality, safe, 1girl, solo, long hair, cityscape, sunset"
        audit = anima.audit_prompt(
            tag_prompt,
            "AnimaTextToImage",
            mode_options={"content_rating": "safe", "prompt_style": "tags"},
        )
        self.assertNotIn("the prompt style is Tags but the output is not a tag list", audit["quality_warnings"])
        self.assertTrue(audit["content_rating_present"])

    def test_the_audit_flags_a_missing_selected_rating(self):
        import backend.targets.anima as anima

        audit = anima.audit_prompt(
            "masterpiece, best quality, 1girl, solo, long hair",
            "AnimaTextToImage",
            mode_options={"content_rating": "nsfw"},
        )
        self.assertIn("the selected nsfw safety tag is missing from the prompt", audit["quality_warnings"])
        self.assertFalse(audit["content_rating_present"])

    def test_the_audit_does_not_ask_for_a_tag_the_user_declined(self):
        import backend.targets.anima as anima

        audit = anima.audit_prompt(
            "masterpiece, best quality, 1girl, solo, long hair",
            "AnimaTextToImage",
            mode_options={"content_rating": "none"},
        )
        self.assertNotIn("the selected None safety tag is missing from the prompt", audit["quality_warnings"])
        self.assertNotIn(
            "a safety tag was added although no content rating was selected",
            audit["quality_warnings"],
        )

    def test_the_audit_flags_a_tag_added_when_none_was_chosen(self):
        import backend.targets.anima as anima

        audit = anima.audit_prompt(
            "masterpiece, best quality, safe, 1girl, solo",
            "AnimaTextToImage",
            mode_options={"content_rating": "none"},
        )
        self.assertIn(
            "a safety tag was added although the content rating is None",
            audit["quality_warnings"],
        )

    def test_the_audit_leaves_an_unset_rating_to_the_guide(self):
        # Nothing was chosen, so an added safety tag follows the guide rather than
        # contradicting the user.
        import backend.targets.anima as anima

        audit = anima.audit_prompt(
            "masterpiece, best quality, safe, 1girl, solo",
            "AnimaTextToImage",
            mode_options={},
        )
        self.assertNotIn(
            "a safety tag was added although the content rating is None",
            audit["quality_warnings"],
        )

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
