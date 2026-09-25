/**
 * Anima character picker and tag-region highlighting.
 *
 * The picker resolves a name the user knows ("miku") into the exact trigger Anima
 * needs ("hatsune miku, vocaloid"). The highlighter colours the five tag regions the
 * guide defines, which is the only feedback a user gets that an Anima prompt's tags
 * are grouped correctly - an Anima prompt is a flat list, so colour carries the
 * structure.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const mainSource = await read("../web/main.js");
const pickerSource = await read("../web/character_picker.js");
const highlightSource = await read("../web/prompt_highlights.js");
const settingsSource = await read("../web/settings.js");
const apiSource = await read("../web/api/prompt_studio.js");
const workbenchCss = await read("../web/styles/workbench.css");
const charactersCss = await read("../web/styles/characters.css");
const responsiveCss = await read("../web/styles/responsive.css");
const stateSource = await read("../web/studio_state.js");

const { animaHighlightMarkup } = await import("../web/prompt_highlights.js");
const { createCharacterPicker } = await import("../web/character_picker.js");

/** Strip tags so a test can prove the highlighter never rewrites the text. */
const plainText = (html) => html.replace(/<[^>]+>/g, "");

test("the Anima highlighter is lossless, like the official one", () => {
  // The existing contract: view.textContent === input. A projection that rewrote the
  // prompt would make the editor and its mirror disagree.
  const samples = [
    "masterpiece, best quality, safe, 1girl, hatsune miku, vocaloid, @artist, long hair",
    "1girl",
    "",
    "no recognised tags at all",
    "trailing comma,",
    ", leading comma",
    "a, b, c, d, e",
  ];
  for (const sample of samples) {
    assert.equal(plainText(animaHighlightMarkup(sample, ["hatsune miku, vocaloid"])), sample, sample);
  }
});

test("the five Anima tag regions are highlighted with distinct classes", () => {
  const text = [
    "masterpiece", "year 2025", "highres", "safe",
    "1girl", "hatsune miku", "vocaloid", "@nnn yryr", "long hair",
  ].join(", ");
  const html = animaHighlightMarkup(text, ["hatsune miku, vocaloid"]);
  assert.match(html, /<mark class="is-quality">masterpiece<\/mark>/);
  assert.match(html, /<mark class="is-quality">year 2025<\/mark>/);
  assert.match(html, /<mark class="is-quality">highres<\/mark>/);
  assert.match(html, /<mark class="is-safety">safe<\/mark>/);
  assert.match(html, /<mark class="is-count">1girl<\/mark>/);
  assert.match(html, /<mark class="is-character">hatsune miku<\/mark>/);
  assert.match(html, /<mark class="is-character">vocaloid<\/mark>/);
  assert.match(html, /<mark class="is-artist">@nnn yryr<\/mark>/);
  // An ordinary appearance tag stays quiet, or the whole prompt would be coloured.
  assert.doesNotMatch(html, /is-\w+">long hair</);
});

test("quality, year and meta tags share one region, as the guide groups them", () => {
  // The guide's tag order is "[quality/meta/year/safety tags]", so these three are one
  // region and the safety tag is its own.
  const html = animaHighlightMarkup("best quality, newest, anime screenshot, safe", []);
  const quality = html.match(/is-quality/g) || [];
  assert.equal(quality.length, 3, "quality, year and meta should all be is-quality");
  assert.match(html, /<mark class="is-safety">safe<\/mark>/);
});

test("score tags count as quality tags", () => {
  for (const tag of ["score_9", "score_7", "score_1"]) {
    assert.match(animaHighlightMarkup(tag, []), new RegExp(`is-quality">${tag}<`), tag);
  }
  // score_10 is not part of the model's vocabulary and must not be assumed.
  assert.doesNotMatch(animaHighlightMarkup("score_10", []), /is-quality/);
});

test("count tags are recognised across their real spellings", () => {
  for (const tag of ["1girl", "2boys", "1other", "solo", "multiple girls", "3girls"]) {
    assert.match(animaHighlightMarkup(tag, []), new RegExp(`is-count">${tag}<`), tag);
  }
  // A bare number or an unrelated number+word is not a count tag.
  for (const tag of ["3", "1girls_", "score_5", "year 2025"]) {
    assert.doesNotMatch(animaHighlightMarkup(tag, []), /is-count/, tag);
  }
});

test("a character is only marked when the index recognised it", () => {
  // Otherwise every prompt's leading tags would look like a character, which would
  // make the colour meaningless.
  const withIndex = animaHighlightMarkup("1girl, hatsune miku, vocaloid", ["hatsune miku, vocaloid"]);
  assert.match(withIndex, /is-character">hatsune miku</);
  assert.match(withIndex, /is-character">vocaloid</);
  const withoutIndex = animaHighlightMarkup("1girl, hatsune miku, vocaloid", []);
  assert.doesNotMatch(withoutIndex, /is-character/);
});

test("the series tag following a recognised character is part of the region", () => {
  // The model writes character and series as two separate tags; they must read as one
  // unit, which is what the guide asks for.
  const html = animaHighlightMarkup("1girl, hatsune miku, vocaloid, @artist", ["hatsune miku, vocaloid"]);
  const order = [...html.matchAll(/is-(\w+)"/g)].map((match) => match[1]);
  assert.deepEqual(order, ["count", "character", "character", "artist"]);
});

test("a comma inside a character name does not leak the region", () => {
  // The trigger is "character, series", so an unescaped split could mis-assign.
  const html = animaHighlightMarkup("hatsune miku, vocaloid, long hair", ["hatsune miku, vocaloid"]);
  assert.doesNotMatch(html, /is-character">long hair</);
});

test("the highlighter is only used for Anima", () => {
  // Other targets write sections and shots, so the Anima projection would leave their
  // prompts entirely unhighlighted.
  assert.match(highlightSource, /context\.targetId === "anima" \|\| format === "anima"/);
  assert.match(mainSource, /targetId: targetForMode\(studio\.mode\)\?\.id \|\| null/);
  assert.match(mainSource, /characters: \(studio\.characters \|\| \[\]\)\.map\(\(entry\) => entry\.trigger\)/);
});

test("the five regions have distinct colours that are not the brand accent", () => {
  for (const region of ["character", "quality", "safety", "artist", "count"]) {
    assert.match(workbenchCss, new RegExp(`mark\\.is-${region} \\{`), region);
  }
  // Each region must have its own background, or the colours would be indistinguishable.
  const backgrounds = ["character", "quality", "safety", "artist", "count"].map((region) => {
    const rule = workbenchCss.match(new RegExp(`mark\\.is-${region} \\{([^}]*)\\}`))?.[1] || "";
    return rule.match(/background:\s*([^;]+);/)?.[1]?.trim();
  });
  assert.equal(new Set(backgrounds).size, 5, `regions must differ: ${backgrounds.join(" | ")}`);
  assert.ok(backgrounds.every(Boolean), "every region needs a background");
});

test("the picker searches, debounces, and supersedes stale replies", () => {
  assert.match(pickerSource, /const SEARCH_DEBOUNCE_MS = \d+/);
  assert.match(pickerSource, /clearTimeout\(searchTimer\)/);
  // A late reply from an earlier keystroke must not overwrite the newer results.
  assert.match(pickerSource, /const token = \+\+searchToken/);
  assert.match(pickerSource, /if \(token !== searchToken\) return;/);
});

test("the picker supports multiple selections and cannot duplicate one", () => {
  assert.match(pickerSource, /const selected = new Map\(\)/);
  assert.match(pickerSource, /if \(selected\.has\(entry\.character\)\) \{[\s\S]{0,80}selected\.delete/);
  assert.match(pickerSource, /onChange\(\{[\s\S]{0,120}characters: \[\.\.\.selected\.keys\(\)\]/);
  assert.match(pickerSource, /triggers: \[\.\.\.selected\.values\(\)\]\.map\(\(entry\) => entry\.trigger\)/);
});

test("the picker escapes what it renders", () => {
  // Character names come from an imported file, so they are untrusted input.
  assert.match(pickerSource, /import \{ escapeHtml \} from "\.\/html\.js"/);
  assert.match(pickerSource, /escapeHtml\(entry\.display_name\)/);
  assert.match(pickerSource, /escapeHtml\(entry\.trigger\)/);
  assert.match(pickerSource, /escapeHtml\(entry\.character\)/);
});

test("the picker is only offered for Anima", () => {
  assert.match(pickerSource, /host\.hidden = targetId !== "anima"/);
  assert.match(mainSource, /studio\.characterPicker\?\.syncVisibility\(targetForMode\(studio\.mode\)\?\.id \|\| null\)/);
});

test("the picker reports nothing about the dataset", () => {
  // The catalogue is fetched automatically on first launch, so there is no user action
  // to prompt for and no state worth surfacing. Any status or hint text would be
  // describing a problem the user cannot act on.
  assert.doesNotMatch(pickerSource, /data-characters-status/);
  assert.doesNotMatch(pickerSource, /data-character-hint/);
  assert.doesNotMatch(pickerSource, /setHint/);
  assert.doesNotMatch(pickerSource, /renderStatus/);
  assert.doesNotMatch(pickerSource, /downloading/);
});

test("a selected character is a bubble using the accent colour", () => {
  assert.match(pickerSource, /class="ps-character-chip"/);
  // The trigger is long, so it goes in the title rather than a second line: otherwise
  // every bubble would wrap and stop reading as a chip.
  assert.match(pickerSource, /data-character-chip="\$\{escapeHtml\(entry\.character\)\}" title="\$\{escapeHtml\(entry\.trigger\)\}"/);
  assert.match(charactersCss, /mark\.is-character|--ps-accent-soft/);
  const bubble = charactersCss.match(/\.ps-character-chip \{([^}]*)\}/)?.[1] || "";
  assert.match(bubble, /border-radius: 999px/, "a bubble must be fully rounded");
  assert.match(bubble, /background: var\(--ps-accent-soft\)/);
  assert.match(bubble, /color: var\(--ps-accent-strong\)/);
});

test("the picker is styled as the same field as the other selectors", () => {
  // The point is that it reads as one of the controls it sits beside, not as a
  // bespoke panel: same label treatment, same control height, same border tokens.
  assert.match(pickerSource, /class="ps-characters ps-field"/);
  const label = charactersCss.match(/\.ps-characters > span \{([^}]*)\}/)?.[1] || "";
  assert.match(label, /text-transform: uppercase/);
  assert.match(label, /font-size: var\(--ps-font-label\)/);
  const search = charactersCss.match(/\.ps-character-search input \{([^}]*)\}/)?.[1] || "";
  assert.match(search, /height: calc\(34px \* var\(--ps-interface-scale\)\)/);
  assert.match(search, /border: 1px solid var\(--ps-border\)/);
  assert.match(search, /border-radius: 7px/);
  // The old bespoke panel chrome must be gone.
  assert.doesNotMatch(charactersCss, /\.ps-characters-head/);
  assert.doesNotMatch(charactersCss, /\.ps-character-hint/);
});

test("a selected character is dropped before it reaches the prompt", () => {
  assert.match(pickerSource, /async function validate\(\)/);
  assert.match(pickerSource, /const dropped = \[\.\.\.selected\.keys\(\)\]\.filter\(\(key\) => !known\.has\(key\)\)/);
  // A failed check must not silently discard the user's selection.
  assert.match(pickerSource, /return \{ characters: \[\.\.\.selected\.keys\(\)\], dropped: \[\], failed: true \}/);
  assert.match(mainSource, /if \(studio\.characterPicker\) await studio\.characterPicker\.validate\(\)/);
});

test("only the character slug is sent, so the backend resolves it", () => {
  assert.match(stateSource, /payload\.characters = state\.characters\.map\(\(entry\) => entry\.character\)/);
  // Empty selections add nothing rather than an empty array.
  assert.match(stateSource, /if \(state\.characters\?\.length\)/);
});

test("a character selection is persisted with its mode draft", () => {
  assert.match(mainSource, /\.\.\.\(studio\.characters\?\.length \? \{ characters: studio\.characters \} : \{\}\)/);
  assert.match(stateSource, /normalized\.characters = characters/);
  assert.match(stateSource, /const MAX_STORED_CHARACTERS = \d+/);
  assert.match(mainSource, /studio\.characterPicker\?\.restore\(studio\.characters\)/);
});

test("a malformed stored character entry is discarded", () => {
  // The slug is what the backend resolves and the trigger is what the highlighter
  // matches, so an entry missing either is unusable.
  assert.match(stateSource, /typeof entry\.character === "string" && entry\.character/);
  assert.match(stateSource, /typeof entry\.trigger === "string" && entry\.trigger/);
});

test("Settings has no character section at all", () => {
  // The dataset is fetched automatically, so there is nothing to configure and no
  // state to display.
  assert.doesNotMatch(settingsSource, /ps-character-settings/);
  assert.doesNotMatch(settingsSource, /data-character-source/);
  assert.doesNotMatch(settingsSource, /data-character-refresh/);
  assert.doesNotMatch(settingsSource, /data-character-import/);
  assert.doesNotMatch(settingsSource, /data-character-clear-import/);
});

test("there is no manual download path in the interface", () => {
  // The download is unambiguously automatic, so no route, client call or handler
  // should exist for triggering it by hand.
  assert.doesNotMatch(mainSource, /downloadCharacterDataset/);
  assert.doesNotMatch(mainSource, /refreshCharacters/);
  assert.doesNotMatch(mainSource, /syncCharacterSettings/);
  assert.doesNotMatch(mainSource, /loadCharacterStatus/);
  assert.doesNotMatch(apiSource, /refreshCharacters/);
  assert.doesNotMatch(apiSource, /characters\/refresh/);
  // The file-import API is gone too, not merely unused.
  assert.doesNotMatch(apiSource, /importCharacters/);
  assert.doesNotMatch(apiSource, /clearCharacters/);
  assert.doesNotMatch(apiSource, /characters\/import/);
});

test("the picker sits after the mode options in the image panel", () => {
  // Content rating and prompt style are the guide's own options, so they read first;
  // characters follow them.
  const panel = mainSource.slice(mainSource.indexOf('data-workspace-panel="image"'));
  const options = panel.indexOf("data-mode-options");
  const characters = panel.indexOf("${characterPickerMarkup()}");
  assert.ok(options >= 0, "the mode options must be in the image panel");
  assert.ok(characters >= 0, "the character picker must be in the image panel");
  assert.ok(options < characters, "characters must come after the mode options");
});

test("the picker is spaced away from the mode options above it", () => {
  // Both are grid items in the image panel, so without an explicit margin the
  // characters label sits flush against the content-rating row.
  const base = charactersCss.match(/\.ps-characters \{([^}]*)\}/)?.[1] || "";
  assert.match(base, /margin-top: 13px/, "the picker needs a top margin");
  // It must track .ps-control-grid, which is the element directly above it, at every
  // responsive breakpoint - otherwise the gap changes with the window size.
  const gridMargins = [...responsiveCss.matchAll(/\.ps-control-grid \{[^}]*margin-top: (\d+)px/g)].map((m) => m[1]);
  const pickerMargins = [...responsiveCss.matchAll(/\.ps-characters \{ margin-top: (\d+)px/g)].map((m) => m[1]);
  assert.deepEqual(
    pickerMargins,
    gridMargins,
    "the picker must follow the control grid's responsive margins",
  );
  assert.ok(gridMargins.length >= 2, "expected the small and large breakpoints");
});

test("the picker controller is evaluable without a DOM", () => {
  // The controller takes its dependencies by injection, so a missing root must not throw.
  const picker = createCharacterPicker({ root: null });
  assert.equal(picker.selection.length, 0);
  picker.attach();
  picker.syncVisibility("anima");
  picker.restore([]);
  assert.deepEqual(picker.selection, []);
});

test("the picker renders typed results and selections end to end", async () => {
  const nodes = new Map();
  const makeElement = (html) => {
    // A minimal stand-in: the controller only queries by data attribute and assigns
    // innerHTML / hidden / textContent.
    const element = {
      innerHTML: html || "",
      hidden: false,
      textContent: "",
      dataset: {},
      value: "",
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      setAttribute() {},
      getAttribute: () => null,
      remove() {},
    };
    return element;
  };
  const root = {
    querySelector: (selector) => {
      if (!nodes.has(selector)) nodes.set(selector, makeElement(""));
      return nodes.get(selector);
    },
  };
  const picker = createCharacterPicker({
    root,
    search: async () => ({
      status: { count: 2, source: "test" },
      results: [
        { character: "hatsune_miku", trigger: "hatsune miku, vocaloid", display_name: "Hatsune Miku", series: "vocaloid" },
        { character: "hakurei_reimu", trigger: "hakurei reimu, touhou", display_name: "Hakurei Reimu", series: "touhou" },
      ],
    }),
    resolve: async (names) => ({ characters: names.map((name) => ({ character: name })), unknown: [] }),
  });
  picker.attach();
  picker.toggle({ character: "hatsune_miku", trigger: "hatsune miku, vocaloid" });
  picker.toggle({ character: "hakurei_reimu", trigger: "hakurei reimu, touhou" });
  assert.deepEqual(
    picker.selection.map((entry) => entry.trigger),
    ["hatsune miku, vocaloid", "hakurei reimu, touhou"],
  );
  // Toggling the same character again removes it rather than duplicating it.
  picker.toggle({ character: "hatsune_miku", trigger: "hatsune miku, vocaloid" });
  assert.deepEqual(picker.selection.map((entry) => entry.character), ["hakurei_reimu"]);
  const validated = await picker.validate();
  assert.deepEqual(validated.dropped, []);
});
