# The Anima Prompting Guide

*Source grounding: this guide is built directly on the official Anima model card
(`circlestone-labs/Anima`, README.md) from CircleStone Labs. All tag vocabulary, tag ordering,
recommended prefixes, sampler notes, and limitations below are taken from that document.*

---

## 1. Three prompt dialects — pick any, or mix them

Anima was trained on tag lists, natural-language captions, and combinations of the two, so all
three are valid inputs. These are the three dialects the prompt **style** setting selects between:

1. **Pure tag lists** (`tags`) — comma-separated Danbooru-style tags, the classic anime-model
   shape. No prose sentences.
2. **Pure natural language** (`natural language`) — descriptive English prose (see §6 for the
   rules). No comma-separated tag list.
3. **Hybrid** (`hybrid`) — tags and prose mixed in arbitrary order. This is the most flexible
   dialect and the one most users converge on: quality/artist tags up front, then a sentence or
   two of natural-language description.

Example of the hybrid style:

```
masterpiece, best quality, @big chungus. An anime girl with medium-length blonde hair is
standing in a sunlit classroom, looking toward the window.
```

There's no dialect penalty — each of the three works well. When a style is requested, stay in
that dialect all the way through rather than drifting back into a tag list partway.
## 2. Tag order

When any part of the prompt is written as tags, group them in this order:

```
[quality/meta/year/safety tags] [1girl/1boy/1other etc] [character, series] [artist] [general tags]
```

- The **order between groups matters**; the order **within** a group does not.
- The count tag (`1girl`, `1boy`, `2girls`, `1other`, …) comes early, right after the
  quality/meta/year/safety block, because it tells the model up front how many subjects to
  compose.
- **Character and series are one group, and always come as a pair in that order**:
  `oomuro sakurako, yuru yuri` — the character's name, then the work it comes from. The
  series is never omitted, and never placed after the artist or among the general tags.
  A character written without its series is an incomplete tag.
- Artist tags come after character/series, general tags (appearance, clothing, pose,
  expression, props, background, composition) come last and can be as long as you like.

---

## 3. Quality tags

Two independent quality-tag vocabularies exist, and Anima was trained on both:

- **Human-score based:** `masterpiece`, `best quality`, `good quality`, `normal quality`,
  `low quality`, `worst quality`
- **PonyV7 aesthetic-model based:** `score_9`, `score_8`, `score_7`, … down to `score_1`

You can use either family alone, both together, or neither — all combinations are valid.

**Recommended positive prefix:**
```
masterpiece, best quality, score_7,
```

**Recommended negative prompt:**
```
worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration
```

---

## 4. Tag vocabulary reference

**Time period tags** — a specific year, or a relative period word:
```
year 2025, year 2024, ...
newest, recent, mid, early, old
```

**Meta tags** — describe the image's production context, not its content:
```
highres, absurdres, anime screenshot, jpeg artifacts, official art, ...
```

**Safety tags** — content rating. Anima was trained on exactly these four, so pick one of them
rather than inventing a synonym, and include it deliberately rather than leaving it out:
```
safe, sensitive, nsfw, explicit
```
`safe` is the mildest and `explicit` the strongest; `sensitive` covers suggestive-but-not-
explicit content. Because the model was trained with these four and nothing else, a rating tag
written any other way (`sfw`, `questionable`, `general`) carries little or no signal.

**Artist tags** — prefix the artist name with `@`. This prefix is mandatory: without it the
effect on style is very weak.
```
@big chungus
@nnn yryr
```

**Character and series tags** — name the character, then the series, in that order:
```
oomuro sakurako, yuru yuri
```

**General tags** — everything else: appearance, clothing, pose, expression, props, background,
and composition. This is the largest and most open-ended group.

### Formatting rules for all tags

- Write tags **lowercase, with spaces instead of underscores** — `long hair`, not `long_hair`.
- `score_*` tags are the one exception and keep their underscore.
- When a tag's spelling differs between Danbooru and Gelbooru, **prefer the Gelbooru
  spelling**.

---

## 5. Dataset tags (ye-pop and DeviantArt)

To widen style and content diversity beyond anime, Anima was additionally trained on two
photo-filtered, non-anime datasets: **LAION-POP (the ye-pop version)** and **DeviantArt**.
Because their captions are qualitatively different from anime captions, they were each labeled
with a dataset tag placed at the very start of the prompt, followed by a newline. An optional
second line can carry the ye-pop image alt-text or the DeviantArt work's title.

```
ye-pop
For Sale: Others by Arun Prem
Abstract, oil painting of three faceless, blue-skinned figures. Left: white, draped figure;
center: yellow-shirted, dark-haired figure; right: red-veiled, dark-haired figure carrying
another. Bold, textured colors, minimalist style.
```

```
deviantart
Flame
Digital painting of a fiery dragon with glowing yellow eyes, black horns, and a long, sinuous
tail, perched on a glowing, molten rock formation. The background is a gradient of dark purple
to orange.
```

Only reach for a dataset tag when you deliberately want the flavor of one of these two caption
styles (abstract/painterly LAION-POP captions, or DeviantArt-style digital-painting captions).
It is not part of an ordinary anime prompt and shouldn't be added by default.

---

## 6. Natural-language prompting

- Follow standard English capitalization for character and series names.
- If you're writing pure natural language, **more descriptive is better** — aim for **at least
  two sentences**. Very short natural-language prompts can produce unexpected results.
- Tags and prose can be mixed in arbitrary order within the same prompt.
- Quality and artist tags can open a natural-language prompt, exactly as in the hybrid example
  in §2.
- **Name the character, then describe their basic appearance,** rather than relying on the name
  alone:

  > *"Digital artwork of Fern from Sousou no Frieren, with long purple hair and purple eyes,
  > wearing a black coat over a white dress with puffy sleeves…"*

  This matters even more with **multiple characters in one image** — if you just list names
  without describing each one's appearance, the model can conflate or confuse them. Give every
  named character their own short appearance description.

---

## 7. Tag dropout — you don't need to be exhaustive

Anima was trained with random tag dropout, meaning individual training captions frequently had
tags randomly removed. Practically, this means:

- You do not need a complete inventory of every relevant tag for a concept.
- Include the tags that carry the ideas you actually care about, and let the model fill in
  reasonable defaults for the rest.
- This makes short, focused tag lists viable — but see §11 on why *very* short prompts can
  still misfire on content, which is a different issue from omitting minor tags.

---

## 8. Weighting

Prompt weighting is supported, but Anima needs **noticeably higher weights than you'd use on
SDXL** to get a comparable effect. A weight that would be a strong emphasis on SDXL may barely
register here.

```
(chibi:2)
```

Start around `1.3–2.0` for a tag you want emphasized and adjust from there rather than reusing
SDXL-scale values like `1.1`.

---

## 9. Full worked tag example

```
year 2025, newest, normal quality, score_5, highres, safe, 1girl, oomuro sakurako, yuru yuri,
@nnn yryr, smile, brown hair, hat, solo, fur-trimmed gloves, open mouth, long hair, gift box,
fang, skirt, red gloves, blunt bangs, gloves, one eye closed, shirt, brown eyes, santa costume,
red hat, skin fang, twitter username, white background, holding bag, fur trim, simple background,
brown skirt, bag, gift bag, looking at viewer, santa hat, ;d, red shirt, box, gift,
fur-trimmed headwear, holding, red capelet, holding box, capelet
```

Reading it group by group, in the order from §2:

1. **Quality/meta/year/safety:** `year 2025, newest, normal quality, score_5, highres, safe`
2. **Count:** `1girl`
3. **Character, then series:** `oomuro sakurako, yuru yuri`
4. **Artist:** `@nnn yryr`
5. **General tags:** everything after that — appearance, clothing, props, pose, expression,
   background — in arbitrary order within the group.

---

## 10. Generation settings that shape prompting choices

These are sampler/scheduler settings rather than prompt text, but they change what a given
prompt actually renders as, so they're worth keeping in mind while you write:

- **Resolution:** works between 512² and 1536² pixels.
- **Steps / CFG:** 30–50 steps, CFG 4–5 (Base and Aesthetic). **Anima-Turbo is the exception —
  CFG 1, 8–12 steps.**
- **Samplers:**
  - `er_sde` — neutral style, flat colors, sharp lines. A reasonable default.
  - `euler_a` — softer, thinner lines, can trend toward a 2.5D look. Tolerates a somewhat
    higher CFG than other samplers without burning the image.
  - `dpmpp_2m_sde_gpu` — similar style family to `er_sde` but more variety and more
    "creative"; depending on the prompt this can get too wild.
  - `euler` — a bit more creative than `er_sde`; pairs well with Turbo and Aesthetic, since
    those checkpoints are already naturally more stable.
- **Scheduler:** for a more realistic or painterly look, the `beta57` scheduler (from the
  ComfyUI RES4LYF custom node pack) puts more emphasis on low-noise timesteps and can improve
  texture quality.

---

## 11. Limitations to write around

- **No realism.** This is an anime/illustration/art model by design; photoreal requests will
  disappoint no matter how the prompt is phrased.
- **Short or vague prompts risk undesired content.** Mitigate this by always including
  appropriate safety tags (`safe`, `sensitive`, `nsfw`, `explicit`) in both the positive and
  negative prompt, and by writing sufficiently detailed prompts rather than terse ones.
- **Weak text rendering.** Single words and occasionally short phrases can render legibly;
  long strings of text will not render reliably. Don't rely on Anima for signage-heavy or
  text-dense images.
- **Anima-Base has a plain default style.** As a true base model, it has not been aesthetic
  tuned on a curated dataset. If you omit artist or quality tags on Base, expect a notably flat,
  neutral look — this is expected behavior, not a bug.

---

## 12. Quick-start templates

**General anime character shot (Aesthetic or Turbo):**
```
masterpiece, best quality, [safety tag], 1girl, [character], [series], solo, [appearance tags],
[clothing tags], [pose/expression], [background], [lighting/composition tags]
```

**Anima-Base, aiming for a specific illustrator look:**
```
masterpiece, best quality, score_7, [safety tag], @[artist], 1girl, [character], [series],
[appearance], [clothing], [pose], [background]
```
The `[safety tag]` slot is the rating selected for the prompt (`safe`, `sensitive`, `nsfw` or
`explicit`). **If no rating was requested, or the rating is None, drop the slot entirely** - do not
default it to `safe`. The quality prefix is independent of the rating and is always present.

Negative: `worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration`

**Natural-language, multi-character scene:**
```
masterpiece, best quality. Digital artwork of [Character A], with [hair/eyes/build], wearing
[outfit], standing beside [Character B], who has [hair/eyes/build] and wears [outfit]. They are
[action/pose] in [setting], under [lighting]. [Mood/style sentence.]
```

---

## 13. Checklist before you submit a prompt

- [ ] A safety tag from the trained set (`safe`, `sensitive`, `nsfw`, `explicit`) is in the positive
      prompt **only when a rating was requested**, and matches that rating. With no rating
      requested, or with the rating set to None, no safety tag belongs in the prompt at all.
- [ ] The whole prompt stays in one dialect (tags, natural language, or hybrid) rather than
      drifting between them
- [ ] Tag groups are in the correct order (quality/meta/year/safety → count → **character+series
      as one pair** → artist → general)
- [ ] Every character is followed by its series, e.g. `hatsune miku, vocaloid` - never the name
      alone, and never the series separated from its character
- [ ] Artist tags are prefixed with `@`
- [ ] Character name is followed by series name
- [ ] Multiple characters each get their own appearance description, not just a name
- [ ] Prompt weights are scaled up from SDXL habits if used
- [ ] Not relying on the model for long rendered text
- [ ] If prompt is very short, added enough detail to avoid unintended content
