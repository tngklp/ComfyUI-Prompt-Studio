import assert from "node:assert/strict";
import test from "node:test";
import { createFloatingMediaPanel } from "../web/floating_media.js";

function fixture(t) {
  const keys = ["document", "window", "innerWidth", "innerHeight"];
  const originals = Object.fromEntries(keys.map(k => [k, globalThis[k]]));
  t.after(() => { for (const k of keys) globalThis[k] = originals[k]; });
  class Element {
    constructor(tag) { this.tag = tag; this.dataset = {}; this.style = {}; this.children = []; this.listeners = new Map(); this.attrs = {}; }
    get classList() {
      return { toggle: (name, on) => {
        const classes = new Set((this.className || "").split(" ")); on ? classes.add(name) : classes.delete(name);
        this.className = [...classes].join(" ");
      }, add: name => { this.className = `${this.className || ""} ${name}`; } };
    }
    set innerHTML(value) {
      this.markup = value;
      if (this.tag === "section") {
        this.header = new Element("header"); this.cards = new Element("div"); this.status = new Element("p");
        this.writer = new Element("button"); this.close = new Element("button");
      }
    }
    querySelector(selector) { return ({ header: this.header, ".ps-assets": this.cards, "[role=status]": this.status,
      "[data-float-writer]": this.writer, "[data-float-close]": this.close })[selector]; }
    setAttribute(k, v) { this.attrs[k] = v; }
    appendChild(el) { this.children.push(el); return el; }
    append(...els) { this.children.push(...els); }
    replaceChildren() { this.children = []; }
    closest(selector) { return selector === "[data-float-asset]" && this.dataset.floatAsset ? this : null; }
    addEventListener(name, fn, options) {
      const records = this.listeners.get(name) || []; this.listeners.set(name, records);
      const record = { fn }; records.push(record);
      options?.signal?.addEventListener("abort", () => records.splice(records.indexOf(record), 1), { once: true });
    }
    async emit(name, options = {}) {
      const event = { target: this, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...options };
      await Promise.all((this.listeners.get(name) || []).slice().map(({ fn }) => fn(event)));
    }
    get offsetWidth() { return 410; }
    get offsetHeight() { return 480; }
    focus() { document.activeElement = this; }
    setPointerCapture() {}
    remove() { this.removed = true; }
  }
  const doc = new Element("document"), win = new Element("window"), body = new Element("body"), canvas = new Element("canvas");
  doc.body = body; doc.createElement = tag => new Element(tag);
  Object.assign(globalThis, { document: doc, window: win, innerWidth: 1000, innerHeight: 800 });
  const state = { assets: [{ id: "a", type: "video", session_id: "s", content_url: "/original", preview_url: "/sheet", filename: "clip.mp4", status: "needs_edit" }], theme: "dark", interfaceSize: "100" };
  const stored = new Map(), storage = { getItem: k => stored.get(k), setItem: (k, v) => stored.set(k, v) };
  const transfers = [];
  const transfer = { destination() {}, drop(snapshot, point, signal) { return new Promise(resolve => transfers.push({ snapshot, point, signal, resolve })); } };
  const panel = createFloatingMediaPanel({ app: { canvas: { canvas } }, getState: () => state, transfer, icon: () => "", storage,
    openWriter: () => panel.suspend(true) });
  const root = body.children[0];
  async function drag() {
    const dataTransfer = { types: [], setData(type) { this.types.push(type); } };
    await root.emit("dragstart", { target: root.cards.children[0], dataTransfer });
    return dataTransfer;
  }
  return { panel, root, state, doc, win, canvas, stored, transfers, drag };
}

test("floating panel follows theme/size, retains position, and suspends with Prompt Studio", async t => {
  const f = fixture(t); f.panel.open();
  assert.equal(f.root.hidden, false); assert.equal(f.root.cards.children.length, 1);
  assert.equal(f.root.cards.children[0].children[1].children[0].textContent, "Trim required");
  await f.root.header.emit("keydown", { key: "ArrowRight" });
  const position = f.root.style.left;
  assert.ok(f.stored.get("ps-floating-media-position"));
  await f.root.writer.emit("click"); assert.equal(f.root.hidden, true);
  assert.equal(f.doc.listeners.get("drop").length, 0);
  f.state.theme = "light"; f.state.interfaceSize = "125";
  f.panel.suspend(false);
  assert.equal(f.root.hidden, false); assert.equal(f.root.dataset.theme, "light");
  assert.equal(f.root.dataset.interfaceSize, "125"); assert.equal(f.root.style.left, position);
  assert.equal(f.doc.listeners.get("drop").length, 1);
  f.panel.close(); f.panel.suspend(false); assert.equal(f.root.hidden, true);
  f.panel.open(); assert.equal(f.root.style.left, position);
  globalThis.innerWidth = 430; await f.win.emit("resize"); assert.equal(f.root.style.left, "12px");
  f.panel.destroy(); assert.equal(f.root.removed, true);
});

test("close or suspend aborts a transfer; reopening permits a new drop without stale feedback", async t => {
  const f = fixture(t); f.panel.open();
  let dataTransfer = await f.drag();
  const oldDrop = f.doc.emit("drop", { target: f.canvas, clientX: 500, clientY: 200, dataTransfer });
  assert.equal(f.transfers.length, 1);
  f.panel.close(); assert.equal(f.transfers[0].signal.aborted, true);
  f.panel.open(); dataTransfer = await f.drag();
  const freshDrop = f.doc.emit("drop", { target: f.canvas, clientX: 600, clientY: 200, dataTransfer });
  assert.equal(f.transfers.length, 2);
  f.transfers[0].resolve(); await oldDrop;
  assert.equal(f.root.status.textContent, "Sending media to workflow…");
  f.transfers[1].resolve(); await freshDrop;
  assert.match(f.root.status.textContent, /Media sent/);
  dataTransfer = await f.drag();
  const suspendedDrop = f.doc.emit("drop", { target: f.canvas, dataTransfer });
  f.panel.suspend(true); assert.equal(f.transfers[2].signal.aborted, true);
  f.transfers[2].resolve(); await suspendedDrop;
  assert.equal(f.root.hidden, true); f.panel.destroy();
});
