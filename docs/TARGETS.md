# Generation targets

A **generation target** is the model a prompt is written *for* — MiniMax H3, MiniMax Music 3, Qwen Image 2.1, Krea 2, Anima.
It is not the same as a **prompt model**, which is the local or remote LLM that writes the prompt.
Those are configured under Settings (Ollama, Direct GGUF, External llama.cpp, API providers) and are
described in [PROVIDERS.md](PROVIDERS.md).

## Supported targets

| Target | Category | Modes | Output shape |
| --- | --- | --- | --- |
| MiniMax H3 | `video` | T2VA, I2VA, FL2VA, L2VA, Reference | Official six-section contract for Reference; three-section for the rest |
| MiniMax Music 3 | `audio` | Caption, Lyrics | Three caption headings; free-form lyrics |
| Qwen Image 2.1 | `image` | Text to Image, Image Edit | One paragraph of natural-language image description |
| Krea 2 | `image` | T2I only | One paragraph of natural-language image description |
| Anima | `image` | T2I only | Danbooru-style tag list, a natural-language caption, or a mixture of the two |

Image and audio targets have no duration. Only image-edit and the H3 reference modes accept input media.
Krea 2 and Anima are text-to-image only: neither has an editing mode and neither takes input media.
Anima is the tag-first target — its guide, prompt prefix and audit all follow the model's own
Danbooru-style conventions rather than the natural-language house style of Qwen Image 2.1 and Krea 2.

Media slots per mode:

| Target | Mode | Accepts | Slots |
| --- | --- | --- | --- |
| MiniMax H3 | T2VA | — | none |
| MiniMax H3 | I2VA | image | 1 |
| MiniMax H3 | FL2VA | image | 2 |
| MiniMax H3 | L2VA | image | 1 |
| MiniMax H3 | Reference | image, video, audio | 9 / 3 / 3, 12 total |
| MiniMax Music 3 | Caption, Lyrics | — | none |
| Qwen Image 2.1 | Text to Image | — | none |
| Qwen Image 2.1 | Image Edit | image | 10 |
| Krea 2 | T2I | — | none |
| Anima | T2I | — | none |

A mode that declares no media renders no drop box at all — only the section heading
and its hint line. The media picker offers stills only for every mode except H3
Reference, so an image-edit mode can never receive a video or an audio file.

## Declared reference slots (writing a prompt before the media exists)

A reference-driven mode normally needs its media attached before a prompt can be written,
because a vision model has to look at the images. That is not always what the user wants:
sometimes the media is still being produced and only the *intent* is known.

Every mode that accepts media therefore offers **Plan a picture** and/or **Plan a video**
next to the drop box. A declared slot:

- reserves the next reference tag (`<Picture 1>`), so the tag can be written in the brief
  immediately and keeps pointing at the same slot once the file arrives;
- carries a **user-authored description** of what will go there;
- is sent to the prompt model as a *declaration*, never as observed content — the model is
  explicitly told the media is not attached and that it must not invent details beyond the
  description;
- is never counted as an attached image, so it consumes no visual token budget and never
  requires a vision projector.

The consequence is that a text-only Direct GGUF can write a Reference-mode prompt as long as
no media is actually attached. The moment a real file is attached, the ordinary vision-capability
check applies again, because a real image does have to be looked at.

### Media-blind mode (attached media the model is not shown)

A declared slot covers media that does not exist yet. The reverse case - the file *is* attached but
the prompt model still must not see it - is **Media-blind mode**, a Settings → Media handling switch.

With it on, attached pictures and videos stay in the workspace and keep their reference tags, but
they are not sent to the prompt model. Each reference is described to the model as attached-but-not-
analysed, with an explicit instruction not to invent its contents, so the model writes that
reference's role from the brief alone. The media box shows a note naming how many references are
being withheld.

What it is for:

- generating with a text-only prompt model when media is already attached;
- keeping image bytes off a remote API provider.

What it costs: with the media withheld, every reference role depends entirely on the brief. A prompt
written this way cannot describe what the model was never shown, so describe what each tag should
contribute.

Mode options per mode:

| Target | Mode | Option | Values | Default |
| --- | --- | --- | --- | --- |
| Anima | T2I | Content rating | None, Safe, Sensitive, NSFW, Explicit | None |
| Anima | T2I | Prompt style | Tags, Natural language, Hybrid | Tags |

The content rating emits the matching safety tag (`safe`, `sensitive`, `nsfw`, `explicit`) — the
four the model was trained on. **None** is an explicit choice to omit the tag, which is different
from leaving the option unset: unset defers to the guide, while *None* instructs the model to add
no safety tag at all. The prompt style constrains the whole output to one of the model's three
dialects.

### Anima character references

Anima expects a character named with its exact spelling followed by its series —
`hatsune miku, vocaloid`, not `Miku` and not `Vocaloid` — and a misspelled or reordered name
degrades the result without any error. The character picker resolves a name you know (`miku`) into
that exact pair, then the prompt places it in the guide's character-and-series position.

Data comes from [AnimaDex](https://animadex.net/?mode=characters), which publishes a CSV whose
`trigger` column already holds the pair in the spelling the model was trained on. That catalogue is
**downloaded on first launch** and cached locally (`backend/data/anima_characters.cache.json`,
about 4 MB, gitignored), so it is not shipped inside the package and no install carries a stale
copy. The download runs in the background and never blocks startup; a first launch with no network
falls back to a small committed sample and the picker says so.

To refresh it, use **Download character data** in **Settings → Media handling → Characters**. It is
only offered while the full catalogue is not on disk. Deleting the cached file makes the next
launch fetch it again.

In **Tags** style the editor colour-codes the guide's five tag regions — character and series,
quality (including time period and meta), safety, artist, and subject count — so a mis-ordered list
is visible at a glance.

The selection is judged against the generated prompt, and both a missing requested rating tag and an
output that ignored the requested style are reported as audit warnings. Option values are validated
against the registry, so an unknown value is rejected with `INVALID_OPTION` rather than ignored.

Attach the real file later with the slot's replace action: the asset ID is preserved, so the
reference tag and everything already written around it stay valid.

## How targets are declared

Targets live in [`targets.json`](../targets.json) at the repository root and are loaded by
[`backend/targets/__init__.py`](../backend/targets/__init__.py). Each entry declares its id, category,
modes, media limits, aspect ratios, duration range, guide references, system-prompt profiles, and the
strategy module that holds its behaviour.

The loader validates every descriptor at import. A malformed target fails loudly rather than silently
degrading, and mode ids must be unique across all targets because they are used as API keys.

That uniqueness rule has a practical consequence: two targets cannot both name a mode
`TextToImage`. Krea 2 therefore declares `Krea2TextToImage` while Qwen Image 2.1 keeps
`TextToImage`; both present the label `T2I`. The **id** is the API key and must be unique, the
**label** is display text and may repeat. The same applies to guide ids within a target, which is
why a guide is always resolved through its owning target rather than by bare id.

## Adding a target

1. **Declare it** in `targets.json`. Add a `modes` entry for each input mode, with `limits` for the
   media it accepts, `system_prompt` naming a profile, and `options` for any per-mode choice the mode
   needs. Each option needs an `id`, a `label`, a `default` (or `null` for opt-in) and a non-empty
   `choices` list whose entries carry `id`, `label` and an optional `prompt_tag`. A choice's
   `prompt_tag` is the vocabulary the guide uses, and `null` means the choice emits nothing.
2. **Add a strategy module** at `backend/targets/<id>.py` implementing `final_contract`, `audit_prompt`,
   `media_contract`, `narrow_repair_messages`, and `multimodal_repair_messages`. See
   [`backend/targets/contract.py`](../backend/targets/contract.py) for the interface.
3. **Add prompt profiles** as `backend/system_prompts/<target-id>/<profile>.txt`, one plain-text
   file per profile named in the descriptor. The folder is the target id, exactly as in
   `guides/`, so a target's prompt text and guide text sit in parallel trees. `available_profiles()`
   scans one level down and ignores a file left at the root, so a misplaced profile is not
   silently accepted.
4. **Add guide content** under `guides/<target-id>/`, one file per guide, and reference each from the
   descriptor by its path relative to `guides/` (for example `qwen_image_2.1/t2i.md`). A guide
   vendored verbatim from an upstream document carries a `source_sha256` integrity pin; a Prompt
   Studio-authored guide sets it to `null` and must have no `guide_source_root`. A guide that is
   *adapted* from an upstream document (provenanced, but rewritten in-repo) sets `"adapted": true`
   with the pin left `null` — it keeps its source URL but is never digest-checked, because an
   edited file can never match the upstream bytes.
5. **Mirror the descriptor** in the built-in snapshot in [`web/target_registry.js`](../web/target_registry.js)
   so the interface renders before the registry request completes.
6. **Add a starter draft** for each new mode id in [`web/mode_defaults.js`](../web/mode_defaults.js).
   A mode with no entry opens with empty fields, which is deliberate: an empty field is better than
   another target's shape.

Step 5 is the only duplicated data. `tests/test_targets.py` asserts that the snapshot agrees with
`targets.json`, so drift fails the suite rather than silently changing interface defaults.
## Choosing a target

The target is chosen from a full-screen picker that opens on every launch, covering the studio
until a target is confirmed. Targets are grouped under **Image**, **Video** and **Audio** headings
and listed with their available modes. A target is only selectable when it has at least one input
mode, so the studio cannot open onto an empty workspace.

After choosing, a compact indicator in the header names the active target and reopens the picker in
one click. It occupies the slot the workspace tab bar used to sit in, so switching target stays a
single click. The mode chips sit in the toolbar below, so changing *mode* and changing *target* are
separate, equally cheap actions.

Both the picker and the indicator are built from `targetList()`. Adding a target to `targets.json`
makes it appear under its category with no interface change. A category the interface does not
recognise is appended under an "Other" heading rather than being hidden.

## Where behaviour lives

| Concern | Location |
| --- | --- |
| Which modes exist, their limits and labels | `targets.json` |
| Per-mode options (rating, style) and their vocabulary | `targets.json` plus `backend/assembly.py` (`_mode_options_directive`) |
| Mode-option controls in the interface | `web/writer_controls.js` (`modeOptionsMarkup`, `bindModeOptions`) |
| Media-blind mode | `backend/assembly.py` (`_blind_media_line`) plus the Settings → Media handling switch |
| Output validation and repair vocabulary | `backend/targets/<id>.py` |
| Prompt text per mode | `backend/system_prompts/<target-id>/<profile>.txt` |
| Mandatory compliance clause appended to every built-in profile | `backend/system_prompts.py` (`COMPLIANCE_CLAUSE`) |
| Guide text and integrity pins | `guides/` plus the descriptor |
| Public catalog for the interface | `GET /promptstudio/targets` |
| Target picker shell | `web/target_selection.js` |
| Target picker, grouping and indicator | `web/main.js` (`targetCategoryGroups`, `syncTargetSelection`, `syncTargetIndicator`) |
| Declared reference slots | `backend/placeholders.py` plus `backend/media.py` (`build_placeholder`, `commit_placeholder`, `resolve_placeholder`) |

The registry is the single source of truth for the backend. The interface reads the same catalog at
startup and falls back to its built-in snapshot if the request fails.

## Prompt files and the compliance clause

Prompt profiles live in per-target folders, mirroring `guides/`:

```text
backend/system_prompts/
  minimax_h3/        base.txt     ref.txt
  minimax_music3/    base.txt     lyrics.txt
  qwen_image_2.1/    base.txt     edit.txt
  krea_2/            base.txt
  anima/             base.txt
```

A profile is resolved through the registry: `load_system_prompt(profile)` finds the target whose
modes declare that profile and reads `<target-id>/<name>.txt`. The folder name is therefore never
written by hand — it is the target id, so renaming a target moves its folder with it, and
`profile_filename()` reports the path it expects so a missing file fails with a usable message.

A profile may be addressed as `"<target-id>/<name>"`, or by bare name while only one target declares
it. Several targets share the name `base`, so that bare name raises `SYSTEM_PROMPT_AMBIGUOUS` rather
than silently returning the wrong target's prompt; `system_prompt_for_mode(mode)` qualifies
automatically and is what internal callers use.

Every built-in profile has a fixed compliance clause appended at load time by
`load_system_prompt()`. It is deliberately **not** stored in the `.txt` files:

- it applies to every profile, so keeping one copy in code makes it impossible to forget for a new
  target and impossible to edit away for an existing one;
- it is not user-visible or user-editable — it is not served as part of any stored prompt text and
  has no Settings control;
- the route (`GET /promptstudio/system-prompt/<mode>`) and the assembly pipeline both read through
  `load_system_prompt()`, so the clause cannot be present in one path and missing in the other.

To change the clause, edit `COMPLIANCE_CLAUSE` in `backend/system_prompts.py`. `reset_cache()` must be
called for a running process to pick up the change; tests call it through `load_system_prompt.cache_clear()`.

An explicit `system_prompt_override` replaces the built-in profile **including** the clause. That is
intentional: the override is the documented escape hatch for a caller who wants different behaviour,
and appending to it would make overriding the clause impossible. `resolve_system_prompt()` returns
`is_custom: true` in that case, which the interface surfaces.
