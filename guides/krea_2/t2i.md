# The Complete Krea 2 Prompting Guide

A comprehensive, practical guide to writing prompts for **Krea 2** (including the **Krea 2 Turbo** checkpoint), Krea's native text-to-image model. This guide expands on Krea's official prompting notes with structure, vocabulary tables, patterns, and worked examples so you can go from a rough idea to a precise, high-fidelity prompt.

*Source grounding: this guide is built on Krea's official `docs/prompting.md` and `docs/expansion.txt` guidance from the [krea-ai/krea-2](https://github.com/krea-ai/krea-2) repository, extended with general best practices for natural-language text-to-image systems.*

---

## 1. Core Philosophy

Krea 2 is built to be prompted the way you'd brief a photographer, illustrator, or art director — **in plain, natural language**, not keyword soup or comma-stacked tag lists like older Stable Diffusion-era prompting.

Three things to internalize before you write a single prompt:

1. **Natural language wins.** Full sentences and flowing descriptive paragraphs outperform disconnected keyword lists (`woman, beach, sunset, 8k, masterpiece, trending on artstation`). Krea 2 was trained to parse grammar, relationships, and modifiers — use that.
2. **Detail scales with control, not with quality.** A two-word prompt will still produce a coherent, well-composed image — Krea 2 doesn't *need* padding to look good. Length is a tool for **specifying what you want**, not a tool for "boosting quality." Every added clause should narrow down the output, not just add noise.
3. **The model rewards concrete, grounded description over abstract mood words.** "Cinematic," "epic," "beautiful," and "masterpiece" do very little on their own. Naming an actual lighting setup, lens behavior, texture, or material does a lot. Show, don't summon.

---

## 2. Anatomy of a Strong Prompt

Think of a prompt as answering these questions, roughly in this order, folded into natural prose (not literal labeled fields):

| Layer | What it covers | Example fragment |
|---|---|---|
| **Subject** | Who/what is the focus, with defining attributes | "a weathered fisherman in his sixties, salt-crusted grey beard" |
| **Action / pose** | What the subject is doing, its orientation | "hauling a net over the gunwale, torso twisted, both arms straining" |
| **Setting / environment** | Where the scene takes place, background elements | "aboard a small wooden trawler, grey swelling sea behind him" |
| **Composition / framing** | Shot type, camera angle, crop, depth of field | "low-angle medium shot, shallow depth of field, net in sharp focus" |
| **Medium / style** | Photograph, painting, render, illustration style | "35mm documentary photograph, Kodak Portra 400 color science" |
| **Lighting** | Light source, quality, direction, color temperature | "overcast diffuse daylight, cool blue-grey tones, soft shadows" |
| **Color & texture** | Palette, material qualities, surface detail | "muted teal and rust palette, visible skin pores, wet rope fibers" |
| **Extra grounding details** | Small specific details that anchor realism/specificity | "a chipped enamel mug wedged against the mast, gull overhead" |

You don't need every layer in every prompt — short prompts that only specify subject + medium + one or two modifiers work fine for simple images. But for **anything you want precise control over**, write it out explicitly rather than hoping the model guesses right.

### Order matters (a little)

Krea 2 reads left to right like any language model, so front-load what matters most. Leading with the subject and medium anchors the whole generation; details appended later refine it. If two ideas conflict (e.g., "photorealistic" vs. "watercolor illustration"), the model will try to reconcile them, usually producing a hybrid you didn't want — so avoid contradictory descriptors.

---

## 3. Prompt Length: Short vs. Long

Krea 2 is explicitly designed to perform well across the whole spectrum, but the two ends behave differently:

**Short prompts** (a phrase or single sentence)
- Fast to iterate with.
- Leave more to the model's own aesthetic judgment (composition, lighting, palette are inferred).
- Best for exploration, mood boards, or when you genuinely don't care about specifics.
- Example: `immense rocket launch exhaust as seen from extremely close up`

**Long, richly detailed prompts** (a full paragraph, 60–150+ words)
- Give you precise control over composition, lighting, palette, texture, and mood simultaneously.
- Let you art-direct multiple subjects, each with independent attributes, without them bleeding into each other.
- Are the better choice for production work, consistent series, or anything with compositional or stylistic requirements.
- Example: `3D rendered matte black designer toy figure, stylized round anthropomorphic shape, backward black baseball cap, oversized gold-rimmed aviator sunglasses, white traditional line-art tattoos of tiger and bird on torso, black studded belt with gold buckle, smooth vinyl texture, studio lighting, solid vibrant blue background, high contrast minimal composition`

**Rule of thumb:** start short to find the general direction, then expand into a full paragraph once you know what you're locking in.

---

## 4. Writing Style: Sentences vs. Tags

Avoid the old "tag soup" style:

> ❌ `girl, anime, school uniform, blue hair, sunset, beach, detailed, masterpiece, best quality, 8k, trending on artstation`

Prefer grounded, connected prose that describes an actual scene:

> ✅ `An anime-style illustration of a girl with messy blue hair, standing on a beach at sunset in her school uniform, wind pulling loose strands across her face as she looks toward the horizon, warm orange light reflecting off the wet sand.`

Krea 2 can still parse comma-separated **descriptive clauses** well (as shown in Krea's own examples below) — the key distinction isn't "no commas allowed," it's that **each clause should be a real, specific description**, not a generic quality tag. `high contrast minimal composition` is a useful clause; `masterpiece, best quality` is not — Krea 2 doesn't use those legacy Stable Diffusion "quality tags," and including them just wastes prompt budget.

---

## 5. Style & Medium

State the medium explicitly and early — it's one of the highest-leverage words in the whole prompt. Krea 2 respects an explicit medium instruction rather than defaulting to photorealism.

| Category | Example terms |
|---|---|
| Photography | `35mm photograph`, `medium-format film photo`, `documentary photography`, `studio portrait`, `macro photograph`, `long-exposure night photograph`, `analog film grain`, `Polaroid` |
| Painting | `oil painting`, `gouache painting`, `watercolor illustration`, `impasto brushwork`, `digital painting`, `airbrush painting` |
| Illustration / graphic | `flat-color illustration`, `ligne claire illustration`, `risograph print`, `vintage travel poster`, `children's book illustration`, `technical line drawing` |
| Anime / cel | `anime-style illustration`, `cel-shaded`, `90s cel animation`, `manga panel`, `shoujo art style` |
| 3D / render | `3D render`, `claymation`, `stylized 3D toy figure`, `vinyl figure`, `unreal engine render`, `octane render`, `low-poly render` |
| Print / collage | `vintage analog collage`, `screen print`, `linocut print`, `halftone print`, `newspaper print texture` |
| Ink / drawing | `pen and ink illustration`, `cross-hatching`, `stippling`, `charcoal sketch`, `pencil sketch` |

**Preserve the medium you asked for.** If you write "photograph of," Krea 2 is built to honor that literally rather than quietly drifting into an illustration — so be deliberate about which one you pick.

---

## 6. Composition & Camera Language

Borrowing precise photographic/cinematographic vocabulary is one of the most effective ways to control layout.

### 6.1 Shot type / framing

| Term | Effect |
|---|---|
| `extreme close-up` | Fills the frame with a small detail (an eye, a hand, a texture) |
| `close-up portrait` | Head and shoulders |
| `medium shot` | Waist-up |
| `wide shot` / `full shot` | Entire subject with surrounding environment |
| `establishing shot` | Emphasizes environment/scale over subject |
| `overhead shot` / `bird's-eye view` | Looking straight down |
| `low-angle shot` | Camera below subject looking up — makes subjects feel powerful/large |
| `high-angle shot` | Camera above subject looking down |
| `over-the-shoulder shot` | Foreground shoulder/figure framing a second subject |

### 6.2 Lens & depth

| Term | Effect |
|---|---|
| `shallow depth of field` | Strong background blur, sharp subject |
| `deep focus` | Everything sharp front-to-back |
| `macro lens` | Extreme close focus with heavy blur falloff |
| `wide-angle lens` | Expanded field of view, slight distortion at edges |
| `telephoto compression` | Flattened perspective, compressed background |
| `bokeh` | Soft, rounded out-of-focus highlights |
| `tilt-shift` | Miniature-like selective focus |

### 6.3 Composition & framing devices

`rule of thirds`, `centered composition`, `symmetrical composition`, `negative space`, `dynamic diagonal composition`, `tightly framed`, `cropped at the waist`, `Dutch angle / tilted framing`, `leading lines`, `foreground framing element`.

---

## 7. Lighting Language

Lighting is arguably the single biggest lever for mood and realism. Be specific about **source, quality, direction, and color temperature**.

| Aspect | Vocabulary |
|---|---|
| Source | `natural daylight`, `golden hour sunlight`, `overcast diffuse light`, `studio lighting`, `neon light`, `candlelight`, `firelight`, `moonlight`, `harsh direct flash` |
| Quality | `soft diffused light`, `hard directional light`, `high-key lighting`, `low-key lighting`, `rim lighting`, `backlighting`, `volumetric light`, `god rays` |
| Direction | `side lighting`, `top-down lighting`, `underlighting`, `three-point studio lighting` |
| Color | `warm amber tones`, `cool blue undertones`, `high contrast`, `desaturated palette`, `vibrant saturated colors`, `monochrome` |
| Shadow behavior | `long dramatic shadows`, `soft gradual shadows`, `sharp graphic shadows`, `deep shadow falloff` |

Combine two or three of these rather than one vague adjective: *"soft directional studio lighting, warm skin tones, deep shadow falloff on the left side"* does far more work than *"cinematic lighting."*

---

## 8. Subject & Character Detail

When describing people or characters, layer attributes the way a casting director or costume designer would, rather than a single blunt adjective:

- **Identity/build**: age range, ethnicity, build, distinguishing features
- **Expression & gaze**: what the face is doing, where the eyes are directed
- **Hair**: color, length, texture, movement ("windblown," "loose strands crossing her face")
- **Clothing**: garment type, color, material, fit, condition (worn/pristine/wet)
- **Pose/gesture**: exact position of limbs, hands, weight distribution
- **Small grounding details**: jewelry, scars, props held, interaction with environment

Example pattern (adapted from Krea's own style):
> `close-up portrait of a young woman, large amber-brown eyes with sparkling reflections, index finger touching a subtle smile, messy dark blue hair with loose strands crossing her face, white and navy uniform, bright high-key lighting with cool blue shadow undertones, shallow depth of field on the hand`

For **multiple subjects**, keep each subject's attributes grouped together in its own clause so the model doesn't cross-contaminate features between them (e.g., don't scatter "red hair" and "blue jacket" across the sentence if they belong to different people — anchor each description to its subject explicitly: *"the woman on the left, in a red coat... the man beside her, in a grey jacket..."*).

---

## 9. Color & Palette Control

You can direct color at two levels:

1. **Scene-level palette** — name a cohesive color scheme: `muted mint green and pale peach palette`, `vibrant cyan and warm neutral tones`, `deep crimson red background`, `monochrome sepia tones`.
2. **Per-element color** — assign color to specific objects/materials directly in their clause: `an orange swim cap`, `a solid vibrant blue background`, `gold-rimmed aviator sunglasses`.

Solid, named background colors (`solid striking crimson red background`, `solid vibrant blue background`) are a reliable way to get clean studio-style compositions with strong subject isolation — useful for product shots, character sheets, or sticker-style art.

---

## 10. Texture, Material & Finish

Naming actual materials and surface qualities pushes realism and tactility far more than generic "detailed" or "high quality" language:

`smooth vinyl texture`, `grainy paper texture`, `visible film grain`, `wet rope fibers`, `weathered stone`, `brushed metal`, `glossy reflective chrome`, `matte finish`, `cracked paint`, `soft textured fur`, `tactile brushstrokes`, `volumetric grain`, `cross-hatched linework`.

---

## 11. Text Rendering

Krea 2 supports legible in-image text. To render text reliably:

- **Wrap the exact words you want rendered in quotation marks.** This is Krea's official recommendation and the single most important rule for text.
- Keep requested text short and specific — signage, labels, single words, or short phrases work best.
- Describe *where* and *how* the text appears (material, style) for extra control: a neon sign, an engraved plaque, a book cover, a storefront window.

**Example:**
> `A weathered wooden storefront sign hand-painted with the words "FRESH BREAD DAILY" in chipped red serif lettering, warm morning light, small bakery facade, soft shadows`

---

## 12. Resolution & Model Notes

- Krea 2 Turbo can generate images up to **2K resolution**.
- The model is capable of strong results from **minimal prompt engineering** — don't feel obligated to write a paragraph if a short prompt captures your intent.
- Detailed prompts generally yield the most controlled, best-composed results when precision matters.

---

## 13. Using an LLM to Expand Your Prompts

Krea publishes an official system prompt (`expansion.txt`) for using an LLM to turn a short idea into a fully expanded Krea 2 prompt. If you want to replicate that workflow yourself (e.g., in Claude, ChatGPT, or another assistant), give the LLM a system prompt with these rules:

1. **Faithfulness first** — preserve the user's original subjects, actions, colors, and spatial relationships; don't invent new objects, props, characters, or animals unless clearly implied.
2. **Practical structure** — group each subject with its own attributes and actions; use grounded phrasing for poses, interactions, and spatial layout so the model can parse it cleanly.
3. **Keep style reasoning internal** — the LLM should think through subject/mood, style/medium/lighting options, and composition, but output only the **final expanded prompt**, not its reasoning.
4. **Text rendering** — any requested visible text, quotes, labels, or typography should be quoted exactly.
5. **Avoid over-specification** — don't invent hyper-specific clothing, colors, or materials the input doesn't support.
6. **One cohesive paragraph** — no bullet points, JSON, or markdown in the final prompt.
7. **Respect existing detail** — if the input is already detailed, polish lightly rather than rewriting or padding it.
8. **Respect the human form** — treat depictions of people with dignity; assume clothing covers intimate anatomy unless stated otherwise.
9. **Preserve the requested medium** — if the user says "photograph of" or "3D render of," keep that medium rather than substituting an easier one.

This is a useful checklist even if you're expanding prompts by hand — it doubles as a self-editing pass before you hit generate.

---

## 14. Common Pitfalls

| Pitfall | Fix |
|---|---|
| Stacking vague quality tags (`8k, masterpiece, trending on artstation, best quality`) | Delete them — describe an actual visual property instead (lighting, lens, material) |
| Contradictory style instructions (`photorealistic anime painting`) | Pick one medium and commit; if you want a hybrid, describe *how* they combine (e.g., "photorealistic skin rendered in a cel-shaded anime composition") |
| Listing 15 unrelated adjectives with no structure | Group attributes by subject/element in short clauses, in a sensible reading order |
| Assuming more words = better quality | Length should map to *how much you need to control*, not to perceived "effort" |
| Vague mood-only lighting ("cinematic lighting") | Specify source + quality + direction + color temperature |
| Multiple characters with tangled attributes | Anchor each attribute explicitly to its subject in its own clause |
| Requesting text without quotes | Always wrap literal in-image text in quotation marks |
| Switching medium mid-prompt unintentionally | State the medium once, early, and keep all following clauses consistent with it |

---

## 15. Prompt Templates

### 15.1 Portrait template
```
[shot type] portrait of [subject with defining attributes], [expression/gaze],
[hair description], [clothing description], [pose/gesture],
[background/setting], [lighting description], [color palette],
[medium/style], [depth of field / lens notes]
```

### 15.2 Scene / environment template
```
[medium/style] of [subject(s) and action] in [setting],
[time of day/weather], [composition/shot type],
[lighting description], [color palette], [key grounding details],
[texture/material notes]
```

### 15.3 Product / object template
```
[medium/style] of [object with material and color details],
[distinct design features], [studio setup / background color],
[lighting description], [composition notes],
[surface finish/texture]
```

### 15.4 Text-in-image template
```
[medium/style] of [scene/object], featuring the text "[EXACT TEXT]"
rendered as [material/typography style] on [surface],
[lighting], [composition]
```

---

## 16. Worked Example Progression

**Step 1 — short idea:**
> `a lighthouse at night`

**Step 2 — add medium + lighting:**
> `long-exposure night photograph of a lighthouse, beam sweeping across a dark sea, moonlight on the water`

**Step 3 — full expanded prompt:**
> `A long-exposure night photograph of a solitary white lighthouse on a rocky cliff, its rotating beam streaking across a low fog bank in a soft glowing arc. Below, dark waves catch faint cold moonlight in scattered highlights. The sky is a deep indigo with a scatter of faint stars, a few wispy clouds moving past. Wide shot, deep focus, long exposure motion blur on the clouds and light beam, cool blue-grey color palette with a single warm amber glow from the lighthouse window, fine film grain, dramatic minimal composition with the lighthouse placed off-center along the rule of thirds.`

This progression — **concept → medium/lighting → fully grounded paragraph** — is the fastest reliable path to a controlled Krea 2 image.

---

## 17. Quick Reference Checklist

Before generating, skim your prompt for:

- [ ] Is the **medium** stated explicitly and only once?
- [ ] Is the **subject** described with concrete, specific attributes (not just "a woman" / "a car")?
- [ ] Is there a **composition/shot type** if framing matters to you?
- [ ] Is **lighting** described with source + quality + direction/color, not just a mood word?
- [ ] Is **color palette** specified if it matters?
- [ ] Are any **quality-tag filler words** removed?
- [ ] Is any requested **in-image text wrapped in quotes**?
- [ ] If multiple subjects: is each one's attributes clearly anchored to it?
- [ ] Does the prompt read as **natural prose**, not a disconnected tag list?