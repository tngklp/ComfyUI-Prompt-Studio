// Shared visual projection. It never changes the underlying prompt text.
const escapeHtml = value => value.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

export function promptHighlightMarkup(text, format = "official") {
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
