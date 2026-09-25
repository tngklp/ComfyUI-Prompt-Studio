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

test("the picker distinguishes a downloading catalogue from a missing one", () => {
  // The catalogue is downloaded rather than shipped, so an unusable index is a
  // normal first-launch state. The hint must say which state it is.
  assert.match(pickerSource, /payload\.downloaded === false/);
  assert.match(pickerSource, /still downloading/);
  assert.match(pickerSource, /has not been downloaded yet/);
  assert.match(pickerSource, /setHint\([\s\S]{0,600}"warning"\)/);
});

test("a stale stored selection is dropped before it reaches the prompt", () => {
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

test("Settings reports the download state and offers a retry", () => {
  assert.match(settingsSource, /data-character-source/);
  assert.match(settingsSource, /data-character-refresh/);
  assert.match(settingsSource, /animadex\.net/);
  // The old file-import flow must be gone: the dataset is now fetched automatically.
  assert.doesNotMatch(settingsSource, /data-character-import/);
  assert.doesNotMatch(settingsSource, /data-character-clear-import/);
  assert.doesNotMatch(settingsSource, /characters\.csv<\/code>\s*here/);
});

test("the retry button is only shown while the catalogue is missing", () => {
  // A permanent download button would invite re-fetching 9 MB for no reason.
  assert.match(mainSource, /refreshButton\.hidden = Boolean\(status\?\.downloaded\)/);
  assert.match(mainSource, /refreshButton\.disabled = studio\.characterRefreshBusy === true/);
  assert.match(mainSource, /showToast\(\s*"Could not download characters"/);
});

test("the download is triggered through the dedicated endpoint", () => {
  assert.match(apiSource, /export const refreshCharacters = \(\) => post\("\/characters\/refresh"\)/);
  // The file-import API is gone, not merely unused.
  assert.doesNotMatch(apiSource, /importCharacters/);
  assert.doesNotMatch(apiSource, /clearCharacters/);
  assert.doesNotMatch(apiSource, /characters\/import/);
});

test("the picker controller is evaluable without a DOM", () => {
  // The controller takes its dependencies by injection, so a missing root must not throw.
  const picker = createCharacterPicker({ root: null });
  assert.equal(picker.selection.length, 0);
  assert.equal(picker.status, null);
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
  picker.renderStatus({ count: 2, source: "test" });
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
