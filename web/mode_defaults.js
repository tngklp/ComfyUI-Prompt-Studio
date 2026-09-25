/**
 * Starter drafts, one per mode.
 *
 * Keyed by mode id, so a mode can never silently inherit another target's
 * example. That is the bug this replaces: an unknown mode fell back to the first
 * entry in the map, so Krea 2, Qwen T2I/Edit and Lyrics all opened with the H3
 * bicycle-courier *video* prompt, complete with [Shot 1] markers and an
 * overall_soundscape section that only make sense for a video target.
 *
 * Each draft is grounded in its own guide: the fields it shows, the syntax it
 * uses, and the medium it names all follow that target's rules.
 *
 * Keys must match the registry mode ids in targets.json. `tests/workspace_panels.mjs`
 * asserts that every mode has one.
 */
export const MODE_DEFAULT_DRAFTS = {
  // --- MiniMax H3 (video) --------------------------------------------------
  T2VA: {
    brief: "At blue hour, a bicycle courier arrives at a quiet rooftop greenhouse, sets down a softly glowing parcel and watches the city lights switch on below. Use one continuous tracking shot, realistic motion and restrained sound.",
    prompt: `integrated_multimodal_description: [Shot 1] Live-action, cinematic, a wide tracking shot follows a bicycle courier across a rain-dark rooftop toward a glass greenhouse at blue hour. The courier brakes beside the doorway, steps down and places a softly glowing parcel on a wooden bench. The camera arcs with small amplitude at slow speed as the courier turns toward the skyline and rows of city lights switch on across the distance. Reflections travel over the greenhouse glass while the courier remains still beside the parcel.

overall_soundscape: Bicycle tires hiss across wet concrete, the chain clicks as the rider stops, and low rooftop wind moves through the greenhouse frame. Distant traffic continues below.

non_diegetic_music: Sparse electronic pulses at a slow tempo with a low sustained synth tone, fading during the final skyline view.`,
  },
  I2VA: {
    brief: "Preserve the person, wardrobe, setting and framing from the uploaded first frame. A small paper bird drifts into view; the person notices it, follows it with their eyes and slowly reaches toward it while the camera gently pushes in.",
    prompt: `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, the person shown in <Picture 1> remains in the same setting, preserving identity, wardrobe, lighting, spatial relationships and opening composition. A small folded paper bird drifts into the frame on a light current of air. The subject notices it, follows its path with their eyes and slowly raises one hand as the camera pushes in with small amplitude at slow speed. The paper bird settles just above the open palm while the original background remains stable.

overall_soundscape: Soft room ambience continues beneath a faint rustle of paper and fabric movement.

non_diegetic_music: A restrained pattern of widely spaced piano notes, ending on a sustained note as the paper bird reaches the hand.`,
  },
  FL2VA: {
    brief: "Create one continuous, physically believable transition from the uploaded opening frame to the uploaded ending frame. A cyclist releases the handlebar, raises and opens an umbrella, then settles precisely into the final pose and composition.",
    prompt: `How the reference pictures align with the target video: Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the final moment of the target video.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, the cyclist begins in the identity, clothing, pose, setting and framing established by <Picture 1>, holding a closed umbrella beside the bicycle. The camera pulls out with small amplitude at slow speed as the cyclist releases the handlebar, raises the umbrella and presses the runner upward until the canopy opens. Water rolls from the expanding fabric while the cyclist steps beneath it, rotates the handle and gradually settles into the exact pose, spacing, object positions, camera angle and final composition established by <Picture 2>.

overall_soundscape: Steady rain falls on the pavement, followed by the metallic click of the umbrella runner and the soft snap of the canopy opening. Water drips from the bicycle as distant traffic passes.

non_diegetic_music: N/A`,
  },
  L2VA: {
    brief: "Build a plausible action that lands exactly on the uploaded final frame. Begin with an intact ceramic cup near the table edge; a hand knocks it down, it breaks on the floor, and every fragment settles into the final arrangement.",
    prompt: `How the reference picture aligns with the target video: <Picture 1> (from [Shot 1]) aligns with the final moment of the target video.

integrated_multimodal_description: [Shot 1] Live-action, cinematic, a close shot begins with an intact ceramic cup near the edge of a dark wooden table. The same hand and sleeve visible in <Picture 1> approach from the right. The camera pushes in with small amplitude at slow speed as the fingertips strike the cup. It tips, falls and breaks against the floor; fragments slide outward and gradually lose momentum. The hand lowers into view while every piece settles into the exact arrangement, lighting, focus, camera angle and final composition established by <Picture 1>.

overall_soundscape: Fingertips tap the ceramic before it scrapes across the tabletop, falls and breaks with a sharp impact. Small fragments scatter and then stop sliding across the floor.

non_diegetic_music: A low electronic pulse at a slow tempo stops immediately when the cup breaks.`,
  },
  Reference: {
    brief: "Use identity and wardrobe from Picture 1 and the slow lateral camera movement from Video 1. A solitary character waits at a rain-soaked tram stop at blue hour, notices an approaching light and turns into the wind. End on a quiet, unresolved look; keep the shot cinematic, realistic and restrained.",
    prompt: `subject_definitions:
<Subject 1> is the coffee shop in <Picture 1>, with a brick wall, orange sofa, neon sign, and wooden table.
<Subject 2> is the white Samoyed in <Picture 2> and <Picture 3>, with pointed ears and a curved tail.
<Subject 3> is the blonde woman in <Video 1>, wearing a pink shirt.
<Subject 4> is the brown-haired man in a grey hoodie from <Video 2>.
<Audio 1> is the voice-timbre reference for <Subject 3> (S1), containing a spoken English vocal layer.

summary:
[reference generation + audio reference] In a three-shot sitcom scene, <Subject 3> eats a cookie inside <Subject 1>. <Subject 4> enters with <Subject 2>, which lunges toward the cookie. <Audio 1> guides <Subject 3>'s voice timbre, and a canned audience laugh ends the exchange.

retention_analysis:
<Subject 1> (appears in all shots): fully_preserved - its layout and key furniture are retained.
<Subject 2> (appears in [Shot 1], [Shot 2]): fully_preserved - its white fur and silhouette are retained.
<Subject 3> (appears in all shots): fully_preserved - her identity and wardrobe are retained.
<Subject 4> (appears in [Shot 1], [Shot 2]): fully_preserved - his identity and wardrobe are retained.
<Audio 1>: reference - its vocal timbre guides <Subject 3> without copying the signal.

detailed_description:
The target video uses a realistic multi-camera sitcom style with warm indoor lighting.
[Shot 1] A medium shot establishes <Subject 1>. <Subject 3> (S1) sits on the sofa holding a cookie. <Subject 4> enters holding <Subject 2>'s leash. The Samoyed lunges toward the cookie. <Subject 3> jerks it back and, using the voice timbre from <Audio 1>, exclaims, <d>[English] Hey! Watch your dog!</d> She guards the cookie while <Subject 4> pulls the dog back.
[Shot 2] At 00:03.000, cut to <Subject 4> (S2) holding <Subject 2> securely. In a playful tone he says, <d>[English] He just likes cookies more than me.</d> He smiles apologetically and strokes the dog's fur.
[Shot 3] At 00:05.000, cut to <Subject 3> (S1). Her annoyance softens. Using <Audio 1>'s timbre, she replies, <d>[English] Well, he has good taste at least.</d> She raises the cookie as a canned audience laugh continues to the final frame.

overall_soundscape:
Soft indoor coffee-shop room tone continues throughout the scene.

non_diegetic_music:
N/A`,
  },

  // --- MiniMax Music 3 (audio) ---------------------------------------------
  Music3: {
    brief: "A reflective indie pop song that grows from close, fragile verses into a bright final chorus. Use warm piano, clean electric guitar, restrained drums, subtle analog texture, an intimate lead vocal and natural modern production.",
    prompt: `### Global Metadata

A reflective indie pop song at a steady mid-tempo pace, moving from tender uncertainty toward clear-eyed optimism. The production is modern and natural, led by warm piano, clean electric guitar, restrained live-feeling drums, rounded bass, and subtle analog texture. Dynamics should remain open and human rather than heavily compressed, with the final chorus providing the widest and brightest moment.

### Vocal Details

An intimate lead vocal begins close and lightly breathy in the verses, with precise phrasing and a vulnerable tone. The delivery gains confidence as the song develops without becoming theatrical. Soft doubles may reinforce selected phrases, while compact harmony layers open around the chorus and expand modestly in the final repeat. Reverb stays warm and controlled so the words remain present.

### Arrangement

[Intro] Warm piano establishes the harmony alone before a faint analog pad and clean guitar harmonics enter at the edges.

[Verse] The lead vocal arrives over piano and sparse guitar arpeggios. Bass enters gradually, while percussion is limited to quiet pulse and texture.

[Chorus] Restrained drums settle into a complete groove as bass, wider guitar voicings, and vocal harmonies lift the arrangement. The transition should feel earned rather than abrupt.

[Final Chorus] The same core palette reaches its fullest scale with brighter piano octaves, broader harmonies, and a subtle sustained texture behind the band. End by letting the drums and bass fall away, leaving the opening piano color to resolve naturally.`,
  },
  Music3Lyrics: {
    // Lyrics mode is output-only: the brief is a revision instruction and the
    // lyrics field carries the payload, so there is no caption prompt.
    brief: "Write finished, performable lyrics about a slow walk home through a city at dawn.",
    lyrics: `[Verse]
Streetlights soften before dawn
I breathe in and carry on
Every window holds a life
Quiet as a folded knife

[Chorus]
A quiet spark becomes a flame
I step ahead and speak my name`,
    prompt: "",
  },

  // --- Qwen Image 2.1 (image) ----------------------------------------------
  TextToImage: {
    brief: "A weathered fisherman in an oilskin coat mends a net with both hands on a fog-covered dock at dawn. A wooden sign beside him reads \"FRESH CATCH\".",
    prompt: `A weathered fisherman in an oilskin coat mends a net with both hands on a fog-covered dock at dawn, his salt-crusted grey beard catching the first light. Medium shot at eye-level, soft backlight from the rising sun creating a warm rim light along his silhouette. Muted teal and rust palette, wet rope fibres and worn canvas texture. Shot as a 35mm film photograph with natural grain. A wooden sign beside him is hand-painted with the words "FRESH CATCH".`,
  },
  ImageEdit: {
    // Edit mode shows an Edit instruction instead of a Creative brief, so the
    // brief field carries the instruction text.
    brief: "Change the background to a sunset beach.",
    prompt: `Change the background to a sunset beach, matching the warm light on the subject. Keep her identity, pose, clothing, and the framing of <image1> unchanged.`,
  },

  // --- Krea 2 (image) ------------------------------------------------------
  Krea2TextToImage: {
    brief: "A solitary white lighthouse on a rocky cliff at night, with its beam sweeping across low fog and dark waves catching cold moonlight.",
    prompt: `A medium-format photograph capturing a solitary white lighthouse situated on a rugged, rocky cliff at night. The lighthouse's brilliant beam sweeps across low fog that blankets the turbulent, dark waves below. The scene is illuminated by cold moonlight, which catches the reflective wetness of the dark rocks and the spray of the incoming waves. Wide shot composition, deep focus, long-exposure technique to capture the ethereal glow of the sweeping light through the dense fog bank. The color palette consists of deep indigos, slate greys, and bright, cool white accents, emphasizing the contrast between the solid structure and the moody, restless water and atmosphere.`,
  },

  // --- Anima (image) -------------------------------------------------------
  AnimaTextToImage: {
    brief: "An anime girl with long silver hair and red eyes in a school uniform, standing on a rooftop at sunset with wind in her hair. Use tag-style prompting with the recommended quality prefix.",
    prompt: `masterpiece, best quality, score_7, safe, year 2025, newest, highres, 1girl, solo, long hair, silver hair, red eyes, school uniform, navy sailor collar, red ribbon, pleated skirt, standing, rooftop, sunset, orange sky, clouds, wind, hair blowing, looking at viewer, serious expression, from below, dramatic lighting, anime screenshot, detailed background`,
  },
};

/** Draft for one mode, resolved from the registry-backed key. */
export function defaultModeDraftFor(mode) {
  const draft = MODE_DEFAULT_DRAFTS[mode];
  if (draft) return draft;
  // An unmapped mode must not borrow another target's example: a video-shaped
  // prompt in an image or audio mode is worse than an empty field.
  return { brief: "", prompt: "", lyrics: "" };
}
