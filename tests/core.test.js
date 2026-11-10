"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const nineSlice = require("../code.js");

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} should equal ${expected}`);
}

function source(overrides = {}) {
  return {
    id: "source", name: "矢量原稿", type: "VECTOR", width: 26, height: 26,
    visible: true, relativeTransform: [[1, 0, 0], [0, 1, 0]], ...overrides
  };
}

function assertTiling(width, height, insets) {
  const slices = nineSlice.planSlices(width, height, insets);
  assert.equal(slices.length, 9);
  close(slices.reduce((area, part) => area + part.width * part.height, 0), width * height);
  for (let row = 0; row < 3; row += 1) {
    const parts = slices.slice(row * 3, row * 3 + 3);
    close(parts[0].x, 0);
    close(parts[0].x + parts[0].width, parts[1].x);
    close(parts[1].x + parts[1].width, parts[2].x);
    close(parts[2].x + parts[2].width, width);
    close(parts.reduce((sum, part) => sum + part.width, 0), width);
    for (const part of parts) {
      close(part.y, parts[0].y);
      close(part.height, parts[0].height);
      assert.ok(part.width >= nineSlice.MIN_SIZE - 1e-8);
      assert.ok(part.height >= nineSlice.MIN_SIZE - 1e-8);
    }
    if (row < 2) close(parts[0].y + parts[0].height, slices[(row + 1) * 3].y);
  }
  close(slices[0].y, 0);
  close(slices[8].y + slices[8].height, height);
  return slices;
}

test("26 px reference keeps 11 px corners and a 4 px centre without gaps", () => {
  const slices = assertTiling(26, 26, { top: 11, right: 11, bottom: 11, left: 11 });
  assert.deepEqual(slices.map(part => [part.width, part.height]), [
    [11, 11], [4, 11], [11, 11], [11, 4], [4, 4], [11, 4], [11, 11], [4, 11], [11, 11]
  ]);
});

test("asymmetric fractional borders cover a fractional source exactly", () => {
  const slices = assertTiling(103.75, 57.5, { top: 7.25, right: 19.5, bottom: 11.75, left: 5.125 });
  close(slices[4].x, 5.125);
  close(slices[4].y, 7.25);
  close(slices[4].width, 79.125);
  close(slices[4].height, 38.5);
});

test("corners pin to their edges; only middle rows and columns stretch", () => {
  const slices = nineSlice.planSlices(100, 80, { top: 10, right: 20, bottom: 30, left: 15 });
  assert.deepEqual(slices.map(part => part.constraints), [
    { horizontal: "MIN", vertical: "MIN" },
    { horizontal: "STRETCH", vertical: "MIN" },
    { horizontal: "MAX", vertical: "MIN" },
    { horizontal: "MIN", vertical: "STRETCH" },
    { horizontal: "STRETCH", vertical: "STRETCH" },
    { horizontal: "MAX", vertical: "STRETCH" },
    { horizontal: "MIN", vertical: "MAX" },
    { horizontal: "STRETCH", vertical: "MAX" },
    { horizontal: "MAX", vertical: "MAX" }
  ]);
  assert.equal(new Set(slices.map(part => part.symbol)).size, 9);
  assert.deepEqual(slices.map(part => part.contentConstraints), slices.map(part => ({
    horizontal: part.constraints.horizontal === "STRETCH" ? "SCALE" : "MIN",
    vertical: part.constraints.vertical === "STRETCH" ? "SCALE" : "MIN"
  })));
});

test("SCALE content constraints preserve source crop boundaries when a tile grows", () => {
  const slices = nineSlice.planSlices(103.75, 57.5, { top: 7.25, right: 19.5, bottom: 11.75, left: 5.125 });
  for (const part of slices) {
    for (const [axis, start, size, sourceSize] of [
      ["horizontal", part.x, part.width, 103.75], ["vertical", part.y, part.height, 57.5]
    ]) {
      const ratio = part.contentConstraints[axis] === "SCALE" ? 2.75 : 1;
      const newOffset = -start * ratio, newSourceSize = sourceSize * ratio;
      close((0 - newOffset) / newSourceSize, start / sourceSize);
      close((size * ratio - newOffset) / newSourceSize, (start + size) / sourceSize);
    }
  }
});

test("defaults and the smallest permitted source produce nine positive tiles", () => {
  for (const [width, height] of [[0.03, 0.03], [26, 26], [103.75, 57.5]]) {
    const insets = nineSlice.defaultInsets(width, height);
    assertTiling(width, height, insets);
  }
});

test("invalid, collapsed or nonnumeric borders are rejected without mutating input", () => {
  const valid = { top: 11, right: 11, bottom: 11, left: 11 };
  for (const bad of [null, {}, { ...valid, left: 0 }, { ...valid, top: -1 },
    { ...valid, bottom: NaN }, { ...valid, right: Infinity }, { ...valid, left: "11" },
    { ...valid, left: 15 }, { ...valid, top: 14.995 }]) {
    assert.throws(() => nineSlice.validateInsets(26, 26, bad));
  }
  const copy = Object.freeze({ ...valid });
  assert.deepEqual(nineSlice.validateInsets(26, 26, copy), valid);
  assert.notEqual(nineSlice.validateInsets(26, 26, copy), copy);
});

test("ordinary vectors, groups, boolean operations and fixed-layout frames are accepted", () => {
  assert.equal(nineSlice.validateSource(source()), 1);
  const tree = source({ type: "FRAME", layoutMode: "NONE", children: [
    source({ type: "GROUP", children: [source({ type: "BOOLEAN_OPERATION", children: [source()] })] })
  ] });
  assert.equal(nineSlice.validateSource(tree), 4);
});

test("unsupported sources and nested editing modes fail with an actionable explanation", () => {
  for (const bad of [null, source({ removed: true }), source({ visible: false }),
    source({ width: 0 }), source({ height: NaN }), source({ isMask: true })]) {
    assert.throws(() => nineSlice.validateSource(bad));
  }
  for (const [child, explanation] of [
    [source({ type: "TEXT" }), /文字转为轮廓/],
    [source({ type: "INSTANCE" }), /分离实例/],
    [source({ type: "FRAME", layoutMode: "HORIZONTAL" }), /移除自动布局/],
    [source({ relativeTransform: [[0, -1, 0], [1, 0, 0]] }), /旋转或翻转/]
  ]) {
    assert.throws(() => nineSlice.validateSource(source({ type: "GROUP", children: [child] })), explanation);
  }
});

// Only host events and messages are stubbed here. Rendering/resize validation runs in real Figma.
function runtimeHarness() {
  const listeners = new Map(), messages = [], lookups = [];
  const page = id => ({
    id, type: "PAGE", selection: [], listeners: new Map(),
    on(event, callback) { this.listeners.set(event, callback); },
    off(event, callback) { if (this.listeners.get(event) === callback) this.listeners.delete(event); }
  });
  const api = {
    currentPage: page("page-a"), showUI() {},
    ui: { postMessage(value) { messages.push(value); } },
    on(event, callback) { listeners.set(event, callback); },
    async getNodeByIdAsync(id) { lookups.push(id); return null; }
  };
  const artwork = (id, parent, overrides = {}) => source({
    id, parent, getPluginData: () => "", exportAsync: async () => new Uint8Array([137, 80, 78, 71]), ...overrides
  });
  nineSlice.start(api, "");
  return { api, listeners, messages, lookups, page, artwork };
}

test("deleted artwork invalidates the preview; selecting a new source clears stale state", async () => {
  const { api, listeners, messages, lookups, artwork } = runtimeHarness();
  const first = artwork("first", api.currentPage);
  api.currentPage.selection = [first];
  await api.ui.onmessage({ type: "ready" });
  assert.equal(messages.at(-1).nodeId, "first");

  first.removed = true;
  api.currentPage.listeners.get("nodechange")({ nodeChanges: [{ type: "DELETE", node: first }] });
  assert.equal(messages.at(-1).type, "selection-error");

  const next = artwork("next", api.currentPage);
  api.currentPage.selection = [next];
  listeners.get("selectionchange")();
  await new Promise(resolve => setTimeout(resolve, 125));
  const selection = messages.at(-1);
  assert.equal(selection.type, "selection");
  assert.equal(selection.nodeId, "next");
  await api.ui.onmessage({ type: "create", nodeId: "next", revision: selection.revision,
    insets: { top: 11, right: 11, bottom: 11, left: 11 } });
  // Lookup is reached only if the previous source's changed flag was cleared.
  assert.deepEqual(lookups, ["next"]);
  assert.match(messages.at(-1).message, /原稿已被移除/);
});

test("page changes suppress an in-flight old preview and keep deletion tracking on the new page", async () => {
  const { api, listeners, messages, page, artwork } = runtimeHarness();
  const oldPage = api.currentPage;
  let finishExport;
  oldPage.selection = [artwork("old", oldPage, {
    exportAsync: () => new Promise(resolve => { finishExport = resolve; })
  })];
  const oldRead = api.ui.onmessage({ type: "ready" });

  const newPage = page("page-b");
  const child = artwork("child", null);
  const next = artwork("new", newPage, { type: "GROUP", children: [child] });
  child.parent = next;
  newPage.selection = [next];
  api.currentPage = newPage;
  listeners.get("currentpagechange")();
  await new Promise(resolve => setImmediate(resolve));
  finishExport(new Uint8Array([137, 80, 78, 71]));
  await oldRead;
  assert.equal(oldPage.listeners.has("nodechange"), false);
  assert.equal(newPage.listeners.has("nodechange"), true);
  assert.deepEqual(messages.filter(item => item.type === "selection").map(item => item.nodeId), ["new"]);

  child.removed = true;
  newPage.listeners.get("nodechange")({ nodeChanges: [{ type: "DELETE", node: child }] });
  assert.equal(messages.at(-1).type, "selection-error");
});
