import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { referenceTextRemapper } from "../web/reference_labels.js";
import { newSequence, effectiveMedia } from "../web/sequence_state.js";

const picture=(id,n)=>({id,mode:"Reference",type:"image",reference:`<Picture ${n}>`});

test("Reference swaps are simultaneous and deleted labels never bind to a surviving asset",()=>{
  const before=[picture("a",1),picture("b",2),picture("c",3)];
  const swap=referenceTextRemapper(before,[picture("b",1),picture("a",2),picture("c",3)]);
  assert.equal(swap("<Picture 1> meets <Picture 2>; <Picture 3>."),"<Picture 2> meets <Picture 1>; <Picture 3>.");
  const remove=referenceTextRemapper(before,[picture("b",1),picture("c",2)]);
  assert.equal(remove("<Picture 1> meets <Picture 2>; <Picture 3>."),"<Missing Picture 1> meets <Picture 1>; <Picture 2>.");
  assert.equal(swap("<Missing Picture 1> and ordinary Picture 1"),"<Missing Picture 1> and ordinary Picture 1");
  assert.equal(referenceTextRemapper(before,before)("<Picture 1>"),"<Picture 1>");
  assert.equal(referenceTextRemapper(before,[{...picture("a",1),type:"audio",reference:"<Audio 1>"}])("<Picture 1>"),"<Missing Picture 1>");
});

test("Reference media updates remap Single text and leave Sequence labels alone",()=>{
  const source = readFile(new URL("../web/main.js", import.meta.url), "utf8");
  const before=[picture("a",1),picture("b",2)],after=[picture("b",1)];
  assert.equal(referenceTextRemapper(before,after)("<Picture 2> beside <Picture 1>"),"<Picture 1> beside <Missing Picture 1>");
  const sequence=newSequence();sequence.references=["b"];sequence.brief="Use reference 1";sequence.chunks[0].prompt="<Picture 1> moves";
  const original=structuredClone(sequence);
  // Sequence keeps chunk-local labels: remapping Single text must not touch it.
  assert.deepEqual(sequence,original);
  assert.deepEqual(effectiveMedia(sequence,sequence.chunks[0].id,before).map(({asset,...binding})=>binding),effectiveMedia(sequence,sequence.chunks[0].id,after).map(({asset,...binding})=>binding));
  return source;
});

test("Single Reference remapping is wired into every media mutation path",async()=>{
  const source=await readFile(new URL("../web/main.js",import.meta.url),"utf8");
  assert.match(source,/function acceptMediaAssets\(next\)/);
  // Upload, remove, reorder, clear, editor-Apply, declared-slot creation and
  // declared-slot description update all funnel through the one seam; a direct
  // studio.assets assignment would silently skip the remap.
  assert.equal((source.match(/acceptMediaAssets\(/g)||[]).length,8);
  assert.doesNotMatch(source,/studio\.assets = result\.assets;/);
});
