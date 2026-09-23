import { clampPanelPosition, workflowMediaSnapshot } from "./workflow_media.js";

const DRAG_TYPE = "application/x-ps-workflow-media";
const POSITION_KEY = "ps-floating-media-position";

export function createFloatingMediaPanel({ app, getState, transfer, icon, openWriter, storage = localStorage }) {
  const root = document.createElement("section");
  root.className = "ps-root ps-media-float";
  root.setAttribute("aria-label", "Prompt Studio media");
  root.innerHTML = `<header class="ps-float-header" tabindex="0" aria-label="Move media panel">
    <strong>Media</strong><span></span>
    <button type="button" class="ps-icon-button" data-float-writer title="Open Prompt Studio" aria-label="Open Prompt Studio">${icon("expand", 15)}</button>
    <button type="button" class="ps-icon-button" data-float-close title="Close media panel" aria-label="Close media panel">${icon("close", 15)}</button>
  </header><p class="ps-float-hint">Drag media to the canvas to add it, or onto a compatible loader to replace its file.</p>
  <div class="ps-assets ps-float-assets"></div>
  <p class="ps-float-status" role="status" aria-live="polite">Original or latest Applied media · no auto-sync</p>`;
  document.body.appendChild(root);
  const header = root.querySelector("header"), cards = root.querySelector(".ps-assets");
  const status = root.querySelector("[role=status]");
  let opened = false, suspended = false, move = null, dragging = null, pending = null, signature = "";
  let position = { x: 24, y: 100 }, events = null;
  try { position = JSON.parse(storage.getItem(POSITION_KEY)) || position; } catch {}
  function place(next = position) {
    position = clampPanelPosition(next, { width: innerWidth, height: innerHeight },
      { width: root.offsetWidth, height: root.offsetHeight });
    root.style.left = position.x + "px"; root.style.top = position.y + "px";
  }
  function savePosition() { try { storage.setItem(POSITION_KEY, JSON.stringify(position)); } catch {} }
  function notice(message) { status.textContent = message; }
  function cancelTransfer() { dragging = null; pending?.abort(); pending = null; move = null; }
  function isOurDrag(event) {
    return !!dragging && Array.from(event.dataTransfer?.types || []).includes(DRAG_TYPE);
  }
  function canvasTarget(event) {
    // DOM overlays and custom widgets are deliberately not treated as empty canvas.
    return event.target === app.canvas?.canvas;
  }
  function refresh() {
    const state = getState();
    root.dataset.theme = state.theme;
    root.dataset.interfaceSize = state.interfaceSize;
    const assets = state.assets.filter(workflowMediaSnapshot);
    const key = JSON.stringify(assets.map(a => [a.id, a.reference, a.status, a.filename, a.content_url, a.preview_url]));
    if (key === signature) { if (opened && !suspended) place(); return; }
    signature = key;
    cards.replaceChildren();
    for (const asset of assets) {
      const card = document.createElement("div");
      card.className = "ps-asset"; card.tabIndex = 0; card.draggable = true; card.dataset.floatAsset = asset.id;
      const title = asset.reference || (asset.status === "needs_edit" ? "Trim required" : asset.type);
      card.title = `${title} · ${asset.filename}\nDrag original or latest Applied media to the workflow`;
      const preview = document.createElement("div"); preview.className = "ps-asset-preview";
      if (asset.preview_url && asset.type !== "audio") {
        const image = document.createElement("img"); image.className = "ps-real-thumb";
        image.src = asset.preview_url; image.alt = ""; image.draggable = false; preview.appendChild(image);
      } else { preview.classList.add("ps-float-audio"); preview.innerHTML = icon("audio", 26); }
      const copy = document.createElement("div"); copy.className = "ps-asset-copy";
      const label = document.createElement("strong"); label.textContent = title;
      const filename = document.createElement("small"); filename.textContent = asset.filename;
      copy.append(label, filename); card.append(preview, copy); cards.appendChild(card);
    }
    if (!assets.length) {
      const empty = document.createElement("p"); empty.className = "ps-float-empty";
      empty.textContent = "Add media in Prompt Studio to use it here."; cards.appendChild(empty);
    }
    if (opened && !suspended) place();
  }
  function bind() {
    if (events) return;
    events = new AbortController();
    const options = { capture: true, signal: events.signal };
    document.addEventListener("dragover", event => {
      if (!isOurDrag(event)) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      let supported = false;
      if (canvasTarget(event)) {
        try { transfer.destination(dragging.snapshot.kind, [event.clientX, event.clientY]); supported = true; } catch {}
      }
      event.dataTransfer.dropEffect = supported ? "copy" : "none";
    }, options);
    document.addEventListener("drop", async event => {
      if (!isOurDrag(event)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const snapshot = dragging.snapshot;
      dragging = null;
      if (!canvasTarget(event)) { notice("Drop on the workflow canvas or a compatible media loader."); return; }
      const controller = new AbortController(); pending = controller;
      notice("Sending media to workflow…");
      try {
        await transfer.drop(snapshot, [event.clientX, event.clientY], controller.signal);
        if (!controller.signal.aborted) notice("Media sent. Later Prompt Studio edits will not change this loader.");
      } catch (error) {
        if (!controller.signal.aborted) notice(error.message || "Media transfer failed.");
      } finally { if (pending === controller) pending = null; }
    }, options);
    window.addEventListener("resize", () => { place(); savePosition(); }, { signal: events.signal });
  }
  function visibility() {
    const visible = opened && !suspended;
    root.classList.toggle("is-open", visible);
    root.hidden = !visible;
    if (visible) { refresh(); place(); bind(); }
    else { events?.abort(); events = null; cancelTransfer(); }
  }
  root.addEventListener("dragstart", event => {
    const card = event.target.closest("[data-float-asset]");
    const asset = getState().assets.find(a => a.id === card?.dataset.floatAsset);
    const snapshot = workflowMediaSnapshot(asset);
    if (!snapshot || pending) { event.preventDefault(); return; }
    dragging = { snapshot };
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(DRAG_TYPE, snapshot.id);
    event.stopPropagation();
  });
  root.addEventListener("dragend", () => { dragging = null; });
  root.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    // Graph keyboard shortcuts must not delete selected nodes while this panel has focus.
    event.stopPropagation();
  });
  header.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.target.closest("button")) return;
    move = { pointer: event.pointerId, x: event.clientX, y: event.clientY, origin: { ...position } };
    header.setPointerCapture(event.pointerId); event.preventDefault();
  });
  header.addEventListener("pointermove", event => {
    if (move?.pointer !== event.pointerId) return;
    place({ x: move.origin.x + event.clientX - move.x, y: move.origin.y + event.clientY - move.y });
  });
  const endMove = () => { move = null; savePosition(); };
  header.addEventListener("pointerup", endMove);
  header.addEventListener("pointercancel", endMove);
  header.addEventListener("keydown", event => {
    if (event.target !== header || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 30 : 10;
    place({ x: position.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
      y: position.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0) });
    savePosition();
  });
  root.querySelector("[data-float-writer]").addEventListener("click", openWriter);
  root.querySelector("[data-float-close]").addEventListener("click", close);
  function close() { opened = false; visibility(); app.canvas?.canvas?.focus(); }
  visibility();
  return {
    open() { opened = true; suspended = false; visibility(); header.focus({ preventScroll: true }); },
    suspend(value) { suspended = value; visibility(); },
    refresh,
    close,
    destroy() { close(); root.remove(); },
  };
}
