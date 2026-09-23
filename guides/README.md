# Guide bundle

Prompt-writing guides, one folder per generation target. Each guide is a Markdown
document handed to the LLM as context when writing a prompt, so the output format
derives from the guide rather than from the system prompt alone.

```
guides/
  minimax_h3/
    base.md    T2VA, I2VA, FL2VA, L2VA
    ref.md     Reference mode
  qwen_image_2.1/
    t2i.md     Text to Image
    edit.md    Image Edit
  krea_2/
    t2i.md     T2I
```

`targets.json` declares each guide's `id`, `title`, `filename` (relative to this
folder) and `source_sha256`. `backend/guides.py` resolves the path, normalizes
only trailing line endings, and verifies the digest before use.

## Integrity pins

A non-null `source_sha256` means the guide is **vendored verbatim** from an
upstream document and must not be edited. Editing it fails the integrity check at
load time.

A `null` `source_sha256` means the guide is **Prompt Studio-authored** and free to
change; no digest needs updating after an edit.

| Guide | Origin | Pin |
| --- | --- | --- |
| `minimax_h3/base.md`, `minimax_h3/ref.md` | `MiniMaxAI/MiniMax-H3` @ `bfc8ed03`, `docs/` | pinned |
| `qwen_image_2.1/t2i.md`, `qwen_image_2.1/edit.md` | `QwenLM/Qwen-Image-2.1` @ `7307809`, `prompt_rewrite/prompts/` | pinned |
| `krea_2/t2i.md` | Prompt Studio-authored | unpinned |

Both official pairs are stored **byte-identical to upstream**, so they can carry a
pin and be verified. Where the upstream output contract differs from what the studio
needs, the difference is handled in code rather than by editing the file:

- The Qwen prompts ask for a JSON envelope (`{"rewritten_prompt": …, "wh_ratio": …}`).
  `normalize_prompt_text` in [`backend/targets/qwen_image.py`](../backend/targets/qwen_image.py)
  unwraps it, keeping the ratio fields out of the editor. See
  `tests/test_targets.py::EnvelopeNormalizationTests`.
- The Qwen guides use upstream `.txt` names. The local copies are renamed `.md`, so
  each descriptor sets `source_filename` to the upstream name; the source URL is
  built from that.

**If a guide must diverge from upstream, do not edit it in place and pin it** — the
pin would fail at load. Either keep it verbatim and adapt in code (preferred), or
mark it `"adapted": true` and drop `source_sha256`; the loader rejects the
combination of a pin and `adapted`, since an adapted file can never match the
upstream digest.

Adding guides for a target means adding the files here **and** declaring them in
`targets.json`. A mode with `"guide": null` relies on its system prompt alone —
MiniMax Music 3 is the current example.

`backend/guides.py` extracts the shared base-guide sections that Reference mode
reuses; that extraction matches on H3 section headings, so renaming them in
`minimax_h3/base.md` requires updating `REFERENCE_EXCERPT_PARAGRAPHS` too.

Do not silently treat community prompting recipes as official guide content.

