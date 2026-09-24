import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { draftFile, draftFilename, parseDraft } from "../web/draft_files.js";
import { newSequence } from "../web/sequence_state.js";
import { buildGeneratePayload, buildRefinePayload } from "../web/studio_state.js";

test("draft filenames identify the workspace and local save time",()=>{
  const now = new Date(2026,8,21,14,3,8);
  assert.equal(draftFilename("sequence",now),"prompt-studio-sequence-2026-09-21_14-03-08.json");
  assert.equal(draftFilename("single",now),"prompt-studio-single-2026-09-21_14-03-08.json");
});

test("Save downloads a loadable draft with a timestamp and no model configuration",async()=>{
  for(const kind of ["single","sequence"]) {
    const content = kind === "sequence" ? newSequence() : {mode:"Reference",aspectRatio:"9:16",duration:8,brief:"Test brief",prompt:"Test prompt",instructions:null};
    const media=["<Picture 1>: portrait.png"];
    const filename=draftFilename(kind);
    assert.match(filename,new RegExp(`^prompt-studio-${kind}-\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}\\.json$`));
    const encoded=JSON.stringify(draftFile(kind,content,media),null,2);
    const loaded=parseDraft(encoded);
    assert.equal(loaded.kind,kind);
    assert.deepEqual(loaded.media,media);
    // Model configuration and credentials are never part of a draft.
    assert.ok(!encoded.includes("apiKey") && !encoded.includes("api_key"));
    assert.ok(!encoded.includes("selectedModel") && !encoded.includes("generationBudget"));
  }
});

test("portable Sequence drafts preserve text and timing but strip live media and history",()=>{
  const state=newSequence(); state.first="old-asset";state.references=["old-asset"];
  state.chunks[0].additions=["old-asset"];state.chunks[0].prompt="Use <Picture 1>";state.chunks[0].undo=["old"];
  const loaded=parseDraft(JSON.stringify(draftFile("sequence",state,["First frame: portrait.png"])));
  assert.equal(loaded.content.chunks[0].prompt,state.chunks[0].prompt);
  assert.equal(loaded.content.first,null);assert.deepEqual(loaded.content.references,[]);
  assert.deepEqual(loaded.content.chunks[0].additions,[]);assert.deepEqual(loaded.content.chunks[0].undo,[]);
  assert.notEqual(loaded.content.chunks[0].id,state.chunks[0].id);
  assert.deepEqual(loaded.media,["First frame: portrait.png"]);
});

test("Single drafts preserve instructions and validate before replacing anything",()=>{
  const content={mode:"Reference",aspectRatio:"9:16",duration:10,brief:"Hello",prompt:"Prompt",instructions:"Keep it brief",api_key:"secret"};
  const loaded=draftFile("single",content);
  assert.equal(loaded.content.instructions,"Keep it brief");assert.equal(loaded.content.api_key,undefined);
  assert.throws(()=>parseDraft('{broken'));
  assert.throws(()=>draftFile("single",{...content,duration:0}));
  assert.throws(()=>draftFile("single",{...content,mode:"bogus"}));
  assert.throws(()=>parseDraft(" ".repeat(2_000_001)));
  assert.equal(draftFile("single",{...content,instructions:"x".repeat(32000)}).content.instructions.length,32000);
});

test("a draft build failure never mutates the workspace, and the loader clears media first",async()=>{
  const source=await readFile(new URL("../web/main.js",import.meta.url),"utf8");
  const loadSource=source.slice(source.indexOf("async function loadTextDraft("),source.indexOf("function updateMusicLyricsCount("));
  // The media is cleared before anything is assigned, and a failed clear returns
  // through the finally block without ever calling setActive on the Sequence.
  const clearIndex=loadSource.indexOf("clearCurrentMedia({ notify: false })");
  const sequenceIndex=loadSource.indexOf("studio.sequence.loadDraft");
  assert.ok(clearIndex > 0 && sequenceIndex > clearIndex, "media must be cleared before the draft is applied");
  assert.match(loadSource,/if \(!cleared\) \{[\s\S]{0,200}setGenerationState\("idle"\)[\s\S]{0,200}return;/);
  assert.doesNotMatch(loadSource,/studio\.assets\s*=/);
});

test("Ollama Generate and Refine carry manual output budget without Direct-only settings",()=>{
  const state={mode:"Reference",customSystemPrompts:{},selectedModel:{family:"ollama",remote_model:"test"},ollamaGenerationBudget:"custom",ollamaGenerationBudgetTokens:6000};
  for(const payload of [buildGeneratePayload(state,{creativeBrief:"x"}),buildRefinePayload(state,{currentPrompt:"y",instruction:"z"})]) {
    assert.equal(payload.generation_budget,6000);assert.equal(payload.context_tokens,undefined);assert.equal(payload.reasoning_effort,undefined);
  }
});

test("portable Single and Sequence drafts preserve long briefs",()=>{
  const brief="A quiet scene. ".repeat(3000);
  const single={mode:"T2VA",aspectRatio:"16:9",duration:10,brief,prompt:"",instructions:null};
  const sequence={...newSequence(),brief};
  for(const [kind,content] of [["single",single],["sequence",sequence]]) {
    assert.equal(parseDraft(JSON.stringify(draftFile(kind,content))).content.brief,brief);
  }
});
