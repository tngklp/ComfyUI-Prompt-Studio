const DEFAULT_LOADERS = { image: "LoadImage", video: "LoadVideo", audio: "LoadAudio" };
const LOADERS = {
  LoadImage: { kind: "image", widget: "image", module: "nodes", flag: "image_upload" },
  LoadImageMask: { kind: "image", widget: "image", module: "nodes", flag: "image_upload" },
  LoadVideo: { kind: "video", widget: "file", module: "comfy_extras.nodes_video", flag: "video_upload" },
  LoadAudio: { kind: "audio", widget: "audio", module: "comfy_extras.nodes_audio", flag: "audio_upload" },
  VHS_LoadVideo: { kind: "video", widget: "video", module: "custom_nodes.comfyui-videohelpersuite" },
};

export function workflowMediaSnapshot(asset) {
  if (!asset || !DEFAULT_LOADERS[asset.type] || !asset.content_url) return null;
  const query = new URLSearchParams({ session_id: asset.session_id, kind: "workflow",
    revision: String(asset.content_revision ?? asset.sample_index ?? 0) });
  return { id: asset.id, kind: asset.type, filename: asset.filename,
    url: `/promptstudio/media/${encodeURIComponent(asset.id)}/content?${query}` };
}

export function supportedLoader(type, definition, kind) {
  const adapter = LOADERS[type];
  if (!adapter || adapter.kind !== kind || definition?.python_module !== adapter.module) return null;
  const spec = definition.input?.required?.[adapter.widget] ?? definition.input?.optional?.[adapter.widget];
  if (!spec || (adapter.flag && !spec[1]?.[adapter.flag]) || !(Array.isArray(spec[0]) || spec[0] === "COMBO")) return null;
  return adapter;
}

export function loaderWidget(node, adapter) {
  const widget = node.widgets?.find(w => w.name === adapter.widget);
  if (widget?.type !== "combo" || typeof widget.callback !== "function" || !Array.isArray(widget.options?.values)) return null;
  if (widget.disabled || node.inputs?.some(input => input.name === adapter.widget && input.link != null)) return null;
  return widget;
}

export function clampPanelPosition(position, viewport, size) {
  return {
    x: Math.max(8, Math.min(Number(position?.x) || 8, Math.max(8, viewport.width - size.width - 8))),
    y: Math.max(8, Math.min(Number(position?.y) || 8, Math.max(8, viewport.height - size.height - 8))),
  };
}

function requireOk(response, message) {
  if (!response.ok) throw new Error(response.status === 409
    ? "Media changed during drag. Drag the current version again." : message);
  return response;
}

function updateLoaderPreview(node, type, value, previousParams) {
  if (type !== "VHS_LoadVideo" || typeof node.updateParameters !== "function") return;
  // VHS's upload callback keeps the full path in filename, but /view expects a separate subfolder.
  const path = String(value || "").replaceAll("\\", "/");
  const slash = path.lastIndexOf("/"), filename = path.slice(slash + 1);
  const extension = filename.slice(filename.lastIndexOf(".") + 1);
  const format = ["gif", "webp", "avif"].includes(extension) ? "image" : "video";
  node.updateParameters({ ...previousParams, filename, subfolder: slash < 0 ? "" : path.slice(0, slash),
    type: "input", format: `${format}/${extension}` }, true);
}

export function createMediaMaterializer(fetchApi) {
  // ComfyUI deduplicates unchanged bytes under the same content-based name.
  async function upload(snapshot, signal) {
    const response = requireOk(await fetchApi(snapshot.url, { signal }), "Could not read Prompt Studio media.");
    const blob = await response.blob();
    const hash = response.headers.get("X-PS-Content-Hash");
    if (!/^[a-f0-9]{64}$/.test(hash || "")) throw new Error("Prompt Studio media identity is unavailable. Refresh and try again.");
    const extensions = { "image/png":"png", "image/jpeg":"jpg", "image/webp":"webp", "image/avif":"avif", "image/gif":"gif",
      "image/bmp":"bmp", "image/tiff":"tiff", "video/mp4":"mp4", "video/webm":"webm", "video/quicktime":"mov",
      "video/x-matroska":"mkv", "audio/wav":"wav", "audio/x-wav":"wav", "audio/mpeg":"mp3",
      "audio/flac":"flac", "audio/x-flac":"flac", "audio/ogg":"ogg", "audio/mp4":"m4a" };
    const ext = extensions[blob.type.split(";")[0]] || snapshot.filename?.match(/\.([a-zA-Z0-9]{1,8})$/)?.[1]?.toLowerCase();
    if (!ext) throw new Error("This media format has no supported file extension.");
    signal?.throwIfAborted();
    const body = new FormData();
    body.append("image", blob, `pw-${hash}.${ext}`);
    body.append("type", "input");
    body.append("subfolder", "prompt-studio");
    const uploaded = requireOk(await fetchApi("/upload/image", { method: "POST", body, signal }), "ComfyUI media upload failed.");
    const data = await uploaded.json();
    if (data.type !== "input" || !data.name || typeof data.name !== "string" || typeof data.subfolder !== "string")
      throw new Error("ComfyUI did not return an input file.");
    return { ...data, value: data.subfolder ? `${data.subfolder}/${data.name}` : data.name };
  }
  return upload;
}

export function createWorkflowMediaTransfer({ app, liteGraph, materialize, getWorkflowRevision = () => 0 }) {
  let active = null;
  function destination(kind, point) {
    const canvas = app.canvas, graph = canvas?.graph;
    if (!graph || canvas.read_only || canvas.allow_interaction === false) throw new Error("Workflow is not editable.");
    const position = app.clientPosToCanvasPos(point);
    if (position.length !== 2 || !position.every(Number.isFinite)) throw new Error("Canvas position is unavailable.");
    const node = graph.getNodeOnPos(...position);
    const type = node?.type || DEFAULT_LOADERS[kind];
    const definition = liteGraph.registered_node_types[type]?.nodeData;
    const adapter = supportedLoader(type, definition, kind);
    if (!adapter || (node && (node.isUploading || !loaderWidget(node, adapter))))
      throw new Error("Drop on empty canvas or a compatible media loader.");
    return { graph, position, node, type, adapter, revision: getWorkflowRevision(),
      nodes: graph._nodes, value: node ? loaderWidget(node, adapter).value : null };
  }
  return {
    destination,
    async drop(snapshot, point, signal) {
      signal?.throwIfAborted();
      if (active && !active.signal?.aborted) throw new Error("Finish the current media transfer first.");
      const target = destination(snapshot.kind, point);
      const job = { signal }; active = job;
      function validate() {
        signal?.throwIfAborted();
        if (active !== job || getWorkflowRevision() !== target.revision || app.canvas?.graph !== target.graph
          || target.graph._nodes !== target.nodes || app.canvas.read_only || app.canvas.allow_interaction === false)
          throw new Error("Workflow changed during transfer. Drop again.");
      }
      let created = null;
      try {
        const file = await materialize(snapshot, signal);
        validate();
        const { graph, node, adapter, type, position } = target;
        if (node && (graph.getNodeById(node.id) !== node || loaderWidget(node, adapter)?.value !== target.value))
          throw new Error("The target loader changed during transfer. Drop again.");
        const receiver = node || liteGraph.createNode(type);
        if (!receiver) throw new Error("ComfyUI could not create this media loader.");
        const widget = loaderWidget(receiver, adapter);
        if (!widget) { if (!node) receiver.onRemoved?.(); throw new Error("This loader has no supported media widget."); }
        const previous = widget.value, values = [...widget.options.values];
        const previewParams = type === "VHS_LoadVideo"
          ? { ...receiver.widgets.find(w => w.name === "videopreview")?.value?.params } : undefined;
        graph.beforeChange?.();
        try {
          if (!node) { receiver.pos = [...position]; created = receiver; graph.add(receiver); }
          if (!widget.options.values.includes(file.value)) widget.options.values.push(file.value);
          widget.value = file.value;
          const result = widget.callback(file.value);
          if (result?.then) await result;
          validate();
          if (graph.getNodeById(receiver.id) !== receiver || widget.value !== file.value)
            throw new Error("The target loader changed during transfer. Drop again.");
          receiver.onWidgetChanged?.(widget.name, file.value, previous, widget);
          updateLoaderPreview(receiver, type, file.value);
          graph.setDirtyCanvas(true, true);
        } catch (error) {
          if (created) { if (graph.getNodeById(created.id) === created) graph.remove(created); }
          else if (graph.getNodeById(receiver.id) === receiver && widget.value === file.value) {
            widget.options.values = values;
            widget.value = previous;
            try { await widget.callback(previous); } catch {}
            try { receiver.onWidgetChanged?.(widget.name, previous, file.value, widget); } catch {}
            try { updateLoaderPreview(receiver, type, previous, previewParams); } catch {}
            graph.setDirtyCanvas(true, true);
          }
          throw error;
        } finally { graph.afterChange?.(); }
        return receiver;
      } finally { if (active === job) active = null; }
    },
  };
}
