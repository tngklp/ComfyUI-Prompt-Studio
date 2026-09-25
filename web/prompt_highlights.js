// Shared visual projection. It never changes the underlying prompt text.
const escapeHtml = value => value.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/**
 * Vocabulary for the Anima tag regions.
 *
 * Anima prompts are comma-separated tag lists, so a region is recognised from the
 * tag's own vocabulary rather than from position: the guide's order is advice to the
 * model, and a prompt that is slightly out of order should still be colour-coded so
 * the user can see *what* is wrong. Each list is deliberately closed - Anima's guide
 * names these exact tags - which keeps ordinary subjects and props unhighlighted
 * instead of guessing.
 */
const ANIMA_QUALITY_TAGS = new Set([
  "masterpiece", "best quality", "good quality", "normal quality", "low quality", "worst quality",
]);
const ANIMA_YEAR_TAGS = new Set(["newest", "recent", "mid", "early", "old"]);
const ANIMA_META_TAGS = new Set([
  "highres", "absurdres", "anime screenshot", "jpeg artifacts", "official art", "twitter username",
  "artist name",
]);
const ANIMA_SAFETY_TAGS = new Set(["safe", "sensitive", "nsfw", "explicit"]);
const ANIMA_ARTIST_PREFIX = "@";
// The subject count tag. Word-bounded so "1girl" matches but "1girls_" does not, and
// a bare number never matches.
const ANIMA_COUNT_TAG = /^\d+\s*(?:girls?|boys?|others?)$|^solo$|^multiple (?:girls|boys)$/;
const ANIMA_SCORE_TAG = /^score_[1-9]$/;

/** Classify one Anima tag into a highlight region, or null for a general tag. */
function animaTagRegion(tag) {
  const value = tag.trim().toLowerCase();
  if (!value) return null;
  if (ANIMA_SAFETY_TAGS.has(value)) return "safety";
  if (ANIMA_QUALITY_TAGS.has(value) || ANIMA_SCORE_TAG.test(value)) return "quality";
  // A year is a period tag ("year 2025"), which the guide groups with the meta tags
  // in the quality/meta/year block, so it shares that region's colour.
  if (ANIMA_YEAR_TAGS.has(value) || ANIMA_META_TAGS.has(value) || /^year \d{4}$/.test(value)) {
    return "quality";
  }
  if (ANIMA_COUNT_TAG.test(value)) return "count";
  if (value.startsWith(ANIMA_ARTIST_PREFIX)) return "artist";
  return null;
}

/**
 * Highlight an Anima prompt's tag regions.
 *
 * Works per comma-separated segment so a region colour cannot bleed into the next
 * tag, and so the character/series pair - which the model writes as two tags - is
 * coloured as one region. Segments the vocabulary does not recognise are left plain,
 * which is what keeps a general appearance or prop tag visually quiet.
 *
 * `characterNames` are the resolved triggers from the character index. Matching on
 * them (rather than on any two leading tags) is what makes the character region
 * trustworthy: without it every prompt's first two tags would look like a character.
 */
export function animaHighlightMarkup(text, characterNames = []) {
  const known = new Set();
  for (const name of characterNames) {
    for (const part of String(name).split(",")) {
      const value = part.trim().toLowerCase();
      if (value) known.add(value);
    }
  }
  // `expectSeriesFor` holds the character name whose series tag is still pending. The
  // guide pairs a character with exactly one following series, so the window closes
  // after a single tag: without that, every later tag would inherit the character
  // colour and the region would bleed down the rest of the prompt.
  let expectSeriesFor = null;
  return text.split(/(,)/).map((segment, index) => {
    // Alternating split: even indices are content, odd are the separators.
    if (index % 2 === 1) return escapeHtml(segment);
    const leading = segment.match(/^\s*/)?.[0] ?? "";
    const trailing = segment.match(/\s*$/)?.[0] ?? "";
    const body = segment.slice(leading.length, segment.length - trailing.length);
    if (!body) return escapeHtml(segment);
    const lower = body.toLowerCase();
    let region = animaTagRegion(body);
    if (region) {
      expectSeriesFor = null;
    } else if (known.has(lower)) {
      // A character tag only counts once the index recognised it. When it is itself a
      // series name - "vocaloid" is both a trigger for some characters and the series
      // of others - it closes the window it was already filling rather than opening a
      // new one. Re-arming here was the bug: it let the window run on and colour the
      // next unrelated tag.
      region = "character";
      expectSeriesFor = expectSeriesFor && expectSeriesFor !== lower ? null : lower;
    } else if (expectSeriesFor) {
      // The one tag directly after a recognised character is its series.
      region = "character";
      expectSeriesFor = null;
    }
    if (!region) return escapeHtml(segment);
    return `${escapeHtml(leading)}<mark class="is-${region}">${escapeHtml(body)}</mark>${escapeHtml(trailing)}`;
  }).join("");
}

export function promptHighlightMarkup(text, format = "official", context = {}) {
  // Anima writes tag lists, so its prompts get the dedicated region highlighter
  // rather than the section/shot/time projection the other targets use.
  if (context.targetId === "anima" || format === "anima") {
    return animaHighlightMarkup(text, context.characters || []);
  }
  const tokens = format === "compact" ? /(?<media>&lt;Picture\s+\d+&gt;)|(?<section>^[ \t]*(?:overall_soundscape|non_diegetic_music)[ \t]*:)/gim : /(?<dialogue>&lt;d&gt;[\s\S]*?&lt;\/d&gt;)|(?<media>@(?:Image|Video|Audio)\d+|&lt;(?:(?:Picture|Video|Audio)\s+\d+|image\d+)&gt;)|(?<subject>&lt;Subject\s+\d+&gt;)|(?<section>^[ \t]*(?:(?:subject_definitions|summary|retention_analysis|detailed_description|integrated_multimodal_description|overall_soundscape|non_diegetic_music)[ \t]*:|###\s+(?:Global Metadata|Vocal Details|Arrangement)\s*$))|(?<shot>\[(?:Shot\s+\d+|Intro|Verse(?:\s+\d+)?|Pre-Chorus|Chorus(?:\s+\d+)?|Bridge|Instrumental|Final Chorus|Outro)\])|(?<time>\b(?:\d{1,2}:\d{2}(?:\.\d{1,3})?|\d+(?:\.\d+)?\s+seconds?)\b)/gim;
  return escapeHtml(text).replace(tokens, (match, ...args) => {
    const groups = args.at(-1);
    if (groups.media) {
      // Two media syntaxes reach the same highlight. H3 uses "<Picture 1>" with a
      // space; Qwen Image 2.1 edit mode uses the guide's own "<image1>", lowercase
      // and unspaced. Both mark as is-image, so the reference looks identical
      // whichever target wrote the prompt.
      const parsed = match.match(/@(?<legacy>Image|Video|Audio)(?<legacyNumber>\d+)|&lt;(?<official>Picture|Video|Audio)\s+(?<officialNumber>\d+)&gt;|&lt;(?<qwen>image)(?<qwenNumber>\d+)&gt;/)?.groups || {};
      const isQwen = Boolean(parsed.qwen);
      const type = isQwen ? "Picture" : (parsed.official || (parsed.legacy === "Image" ? "Picture" : parsed.legacy));
      const number = parsed.qwenNumber || parsed.officialNumber || parsed.legacyNumber;
      const mediaClass = type === "Picture" ? "image" : type.toLowerCase();
      // The tag round-trips the author's original spelling, so the peek and the
      // insert-menu lookup still match the asset's own reference value.
      return `<mark class="is-${mediaClass}" data-prompt-reference="<${isQwen ? "image" : `${type} `}${number}>">${match}</mark>`;
    }
    const kind = groups.subject ? "subject" : groups.section ? "section" : groups.shot ? "shot" : groups.time ? "time" : "dialogue";
    return `<mark class="is-${kind}">${match}</mark>`;
  });
}

// Keep the editor mirror as one text node. Inline marks round text runs
// separately in Chromium and can move a word onto a different wrapped line.
export function createPromptMirrorHighlighter(doc) {
  const registry = doc.defaultView.CSS?.highlights, Highlight = doc.defaultView.Highlight;
  const groups = new Map();
  function clear() {
    for (const [name, group] of groups) if (registry?.get(name) === group) registry.delete(name);
    groups.clear();
  }
  function paint(layer, markup) {
    if (!registry || !Highlight) {
      if (layer.innerHTML !== markup) layer.innerHTML = markup;
      return;
    }
    const template = doc.createElement("template");
    template.innerHTML = markup;
    const text = template.content.textContent;
    if (layer.textContent !== text || layer.childNodes.length !== 1) layer.textContent = text;
    let offset = 0;
    for (const node of template.content.childNodes) {
      const end = offset + node.textContent.length;
      if (node.nodeType === 1 && end > offset) {
        const name = "ps-sequence-" + node.className.slice(3);
        let group = groups.get(name);
        if (!group) { group = new Highlight(); groups.set(name, group); registry.set(name, group); }
        const range = doc.createRange();
        range.setStart(layer.firstChild, offset); range.setEnd(layer.firstChild, end);
        group.add(range);
      }
      offset = end;
    }
  }
  return { clear, paint };
}
