import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../web/workflow_media.js", import.meta.url), "utf8");
const { workflowMediaSnapshot, supportedLoader, loaderWidget, createMediaMaterializer,
  createWorkflowMediaTransfer, clampPanelPosition } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const definitions = {
  LoadImage: { python_module: "nodes", input: { required: { image: [["old.png"], { image_upload: true }] } } },
  LoadImageMask: { python_module: "nodes", input: { required: { image: [["old.png"], { image_upload: true }] } } },
  LoadVideo: { python_module: "comfy_extras.nodes_video", input: { required: { file: ["COMBO", { video_upload: true }] } } },
  LoadAudio: { python_module: "comfy_extras.nodes_audio", input: { required: { audio: ["COMBO", { audio_upload: true }] } } },
  VHS_LoadVideo: { python_module: "custom_nodes.comfyui-videohelpersuite", input: { required: { video: [["old.mp4"]] } } },
};
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const file = { value: "prompt-studio/pw-test.mp4" };
function harness(type = null, materialize = async () => file) {
  let id = 0, hit = null, revision = 0;
  const changes = [];
  function makeNode(type) {
    const name = Object.keys(definitions[type].input.required)[0];
    const node = { id: ++id, type, inputs: [], outputs: [{ links: [42] }], preview: "old",
      widgets: [{ name, type: "combo", value: "old", options: { values: ["old"] }, callback(value) { node.preview = value; } }],
      onWidgetChanged(...args) { changes.push(args); } };
    return node;
  }
  const graph = { _nodes: [], getNodeOnPos: () => hit, getNodeById: id => graph._nodes.find(n => n.id === id),
    add(n) { graph._nodes.push(n); }, remove(n) { graph._nodes.splice(graph._nodes.indexOf(n), 1); },
    beforeChange() {}, afterChange() {}, setDirtyCanvas() {} };
  const app = { canvas: { graph }, clientPosToCanvasPos: ([x, y]) => [x / 2, y / 2] };
  const liteGraph = { registered_node_types: Object.fromEntries(Object.entries(definitions).map(([k, nodeData]) => [k, { nodeData }])), createNode: makeNode };
  if (type) { hit = makeNode(type); graph.add(hit); }
  const transfer = createWorkflowMediaTransfer({ app, liteGraph, materialize, getWorkflowRevision: () => revision });
  return { app, graph, liteGraph, transfer, node: hit, changes, switchWorkflow() { revision++; } };
}

test("workflow snapshots use original/applied content, including staged media, never sheet or draft", () => {
  for (const type of ["image", "video", "audio"]) {
    const asset = { id: "a", session_id: "s", type, content_url: "/original", preview_url: "/sheet", draft: "/draft", status: "needs_edit", content_revision: 4 };
    const snapshot = workflowMediaSnapshot(asset);
    assert.equal(snapshot.kind, type);
    assert.match(snapshot.url, /kind=workflow&revision=4$/);
    assert.doesNotMatch(snapshot.url, /sheet|draft/);
    assert.notEqual(workflowMediaSnapshot({ ...asset, content_revision: 5 }).url, snapshot.url);
  }
  assert.equal(workflowMediaSnapshot({ type: "image" }), null);
});

test("loader adapters are exact, including VHS Upload but not arbitrary video nodes", () => {
  for (const [type, kind] of [["LoadImage", "image"], ["LoadImageMask", "image"], ["LoadVideo", "video"], ["LoadAudio", "audio"], ["VHS_LoadVideo", "video"]]) {
    assert.ok(supportedLoader(type, definitions[type], kind));
    assert.equal(supportedLoader(type, { ...definitions[type], python_module: "custom" }, kind), null);
  }
  assert.equal(supportedLoader("VHS_LoadVideoPath", definitions.VHS_LoadVideo, "video"), null);
  assert.equal(supportedLoader("LoadImage", definitions.LoadImage, "video"), null);
  const h = harness("LoadImage"), adapter = supportedLoader("LoadImage", definitions.LoadImage, "image");
  h.node.inputs.push({ name: "image", link: null });
  assert.ok(loaderWidget(h.node, adapter));
  h.node.inputs[0].link = 42;
  assert.equal(loaderWidget(h.node, adapter), null);
});

test("empty-canvas drops create one native node at converted coordinates for each media kind", async () => {
  for (const [kind, type] of [["image", "LoadImage"], ["video", "LoadVideo"], ["audio", "LoadAudio"]]) {
    const h = harness();
    const node = await h.transfer.drop({ kind }, [100, 200]);
    assert.equal(node.type, type); assert.deepEqual(node.pos, [50, 100]);
    assert.equal(h.graph._nodes.length, 1); assert.equal(node.widgets[0].value, file.value);
  }
});

test("native and VHS replacement preserve identity, links and unrelated widgets", async () => {
  for (const [type, kind] of [["LoadImage", "image"], ["LoadVideo", "video"], ["LoadAudio", "audio"], ["VHS_LoadVideo", "video"]]) {
    const h = harness(type); h.node.widgets.push({ name: "frame_load_cap", value: 16 });
    assert.equal(await h.transfer.drop({ kind }, [0, 0]), h.node);
    assert.deepEqual(h.node.outputs, [{ links: [42] }]);
    assert.equal(h.node.widgets[1].value, 16); assert.equal(h.node.preview, file.value);
    assert.equal(h.changes.length, 1); assert.equal(h.graph._nodes.length, 1);
  }
});

test("unsupported, read-only, disabled and converted targets do not materialize", async () => {
  for (const change of [h => h.node.type = "Unknown", h => h.app.canvas.read_only = true,
    h => h.app.canvas.allow_interaction = false, h => h.node.widgets[0].disabled = true,
    h => h.node.inputs.push({ name: "image", link: 42 })]) {
    let uploads = 0; const h = harness("LoadImage", async () => { uploads++; return file; }); change(h);
    await assert.rejects(h.transfer.drop({ kind: "image" }, [0, 0])); assert.equal(uploads, 0);
  }
});

test("upload races do not mutate a changed graph or target", async () => {
  for (const change of [h => h.app.canvas.graph = {}, h => h.switchWorkflow(), h => h.graph.remove(h.node),
    h => h.node.widgets[0].value = "user.png", h => h.app.canvas.read_only = true, h => h.graph._nodes = []]) {
    const wait = deferred(), h = harness("LoadImage", () => wait.promise);
    const pending = h.transfer.drop({ kind: "image" }, [0, 0]); change(h); wait.resolve(file);
    await assert.rejects(pending); assert.notEqual(h.node.widgets[0].value, file.value);
  }
});

test("cancelled upload can be followed immediately by a fresh transfer", async () => {
  const old = deferred(); let calls = 0;
  const h = harness(null, () => ++calls === 1 ? old.promise : Promise.resolve(file));
  const controller = new AbortController();
  const pending = h.transfer.drop({ kind: "image" }, [0, 0], controller.signal);
  controller.abort();
  await h.transfer.drop({ kind: "video" }, [20, 30], new AbortController().signal);
  old.resolve(file); await assert.rejects(pending, { name: "AbortError" });
  assert.equal(h.graph._nodes.length, 1); assert.equal(h.graph._nodes[0].type, "LoadVideo");
});

test("callback failures restore the old source, preview and change notification", async () => {
  const h = harness("VHS_LoadVideo");
  h.node.widgets[0].callback = value => { h.node.preview = value; if (value === file.value) throw Error("preview failure"); };
  await assert.rejects(h.transfer.drop({ kind: "video" }, [0, 0]), /preview failure/);
  assert.equal(h.node.widgets[0].value, "old"); assert.equal(h.node.preview, "old");
  assert.deepEqual(h.node.widgets[0].options.values, ["old"]); assert.equal(h.changes.at(-1)[1], "old");
  assert.deepEqual(h.node.outputs, [{ links: [42] }]);
  const empty = harness();
  const make = empty.liteGraph.createNode;
  empty.liteGraph.createNode = type => { const n = make(type); n.widgets[0].callback = () => { throw Error("failure"); }; return n; };
  await assert.rejects(empty.transfer.drop({ kind: "image" }, [0, 0])); assert.equal(empty.graph._nodes.length, 0);
});

test("cancellation during an asynchronous callback rolls back only this transfer", async () => {
  const h = harness("LoadImage"), wait = deferred(), started = deferred(), controller = new AbortController();
  h.node.widgets[0].callback = value => { h.node.preview = value; if (value === file.value) { started.resolve(); return wait.promise; } };
  const pending = h.transfer.drop({ kind: "image" }, [0, 0], controller.signal);
  await started.promise; controller.abort(); wait.resolve(); await assert.rejects(pending);
  assert.equal(h.node.preview, "old"); assert.equal(h.node.widgets[0].value, "old");
});

test("VHS preview separates the subfolder without changing source or other controls", async () => {
  for (const extension of ["mp4", "webm", "gif", "webp", "avif"]) {
    const value = `prompt-studio/nested/clip.${extension}`;
    const h = harness("VHS_LoadVideo", async () => ({ value }));
    const preview = { name: "videopreview", value: { params: { force_rate: 12 } } };
    h.node.widgets.push(preview);
    const order = [];
    h.node.widgets[0].callback = v => { order.push("callback"); Object.assign(preview.value.params, { filename: v }); };
    h.node.onWidgetChanged = () => order.push("change");
    h.node.updateParameters = (params, force) => { order.push("preview"); assert.equal(force, true); Object.assign(preview.value.params, params); };
    await h.transfer.drop({ kind: "video" }, [0, 0]);
    assert.equal(h.node.widgets[0].value, value);
    assert.deepEqual(preview.value.params, { force_rate: 12, filename: `clip.${extension}`, subfolder: "prompt-studio/nested", type: "input",
      format: `${["gif", "webp", "avif"].includes(extension) ? "image" : "video"}/${extension}` });
    assert.deepEqual(order, ["callback", "change", "preview"]);
    assert.deepEqual(h.node.outputs, [{ links: [42] }]);
  }
  const h = harness("LoadVideo");
  h.node.updateParameters = () => assert.fail("Native loaders must not receive a VHS preview update");
  await h.transfer.drop({ kind: "video" }, [0, 0]);
});

test("VHS preview failure rolls back both subfolder and root-input sources", async () => {
  for (const old of ["old.mp4", "previous/old.webm"]) {
    const h = harness("VHS_LoadVideo"); h.node.widgets[0].value = old;
    const params = { filename: old, type: "input", force_rate: 12, subfolder: "" };
    h.node.widgets.push({ name: "videopreview", value: { params } });
    h.node.widgets[0].callback = value => { params.filename = value; };
    h.node.updateParameters = next => { Object.assign(params, next); if (next.filename === "pw-test.mp4") throw Error("preview failed"); };
    await assert.rejects(h.transfer.drop({ kind: "video" }, [0, 0]), /preview failed/);
    assert.equal(h.node.widgets[0].value, old);
    assert.equal(params.filename, old.split("/").at(-1));
    assert.equal(params.subfolder, old.includes("/") ? "previous" : "");
    assert.equal(params.force_rate, 12); assert.equal(params.type, "input");
    assert.equal(h.changes.at(-1)[1], old);
    assert.deepEqual(h.node.outputs, [{ links: [42] }]);
  }
});

test("materialization preserves bytes and stable names without browser hashing or overwrite", async () => {
  const bodies = []; let revision = "a";
  const upload = createMediaMaterializer(async (url, options) => {
    if (url === "/upload/image") { bodies.push(options.body); return Response.json({ type: "input", subfolder: "prompt-studio", name: options.body.get("image").name }); }
    return new Response("video bytes", { headers: { "Content-Type": "video/mp4", "X-PS-Content-Hash": revision.repeat(64) } });
  });
  const a = await upload({ url: "/a" }), b = await upload({ url: "/a" }); revision = "b";
  const c = await upload({ url: "/b" });
  assert.equal(a.value, b.value); assert.notEqual(a.value, c.value);
  assert.match(a.value, /^prompt-studio\/pw-/);
  assert.equal(await bodies[0].get("image").text(), "video bytes"); assert.equal(bodies[0].has("overwrite"), false);
  assert.doesNotMatch(source, /crypto\.subtle|arrayBuffer|handleFile/);
  await assert.rejects(createMediaMaterializer(async () => new Response("", { status: 409 }))({ url: "/stale" }), /Media changed/);
});

test("panel stays non-modal, viewport-clamped and wired through one independent entry point", async () => {
  const main = await readFile(new URL("../web/main.js", import.meta.url), "utf8");
  const panel = await readFile(new URL("../web/floating_media.js", import.meta.url), "utf8");
  const opening = main.slice(main.indexOf("function supportsWorkflowMedia"), main.indexOf("function openStudio"));
  assert.doesNotMatch(opening, /VRAM_HANDOFF_SUPPORTED/);
  assert.match(opening, /Add media first/); assert.match(main, /<strong>Media panel<\/strong><small>ADD TO WORKFLOW/);
  assert.match(main, /querySelectorAll\("\[data-open-floating-media\]"\)/);
  assert.match(panel, /application\/x-ps-workflow-media/);
  assert.match(panel, /pending\?\.abort/); assert.match(panel, /stopImmediatePropagation/);
  assert.doesNotMatch(panel, /aria-modal|backdrop|handleFile/);
  assert.deepEqual(clampPanelPosition({ x: 999, y: -20 }, { width: 800, height: 600 }, { width: 410, height: 200 }), { x: 382, y: 8 });
});
