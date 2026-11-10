/* Vector 9 Slice. No image paints are created; PNG export is for the UI only. */
var VectorNineSlice = (() => {
  "use strict";

  const MIN_SIZE = 0.01;
  const MAX_NODES = 2000;
  const META_KEY = "vector-nine-slice-v1";
  const SUPPORTED = new Set([
    "FRAME", "GROUP", "BOOLEAN_OPERATION", "VECTOR", "RECTANGLE", "ELLIPSE",
    "POLYGON", "STAR", "LINE"
  ]);
  const DIRECTIONS = [
    ["↖️", "左上", "MIN", "MIN"], ["⬆️", "上", "STRETCH", "MIN"],
    ["↗️", "右上", "MAX", "MIN"], ["⬅️", "左", "MIN", "STRETCH"],
    ["↔️↕️", "中心", "STRETCH", "STRETCH"], ["➡️", "右", "MAX", "STRETCH"],
    ["↙️", "左下", "MIN", "MAX"], ["⬇️", "下", "STRETCH", "MAX"],
    ["↘️", "右下", "MAX", "MAX"]
  ];

  function fail(message) { throw new Error(message); }

  function visit(node, callback) {
    callback(node);
    if ("children" in node) for (const child of node.children) visit(child, callback);
  }

  function validateSource(source) {
    if (!source || source.removed) fail("原稿已被移除，请重新选择。");
    if (!Number.isFinite(source.width) || !Number.isFinite(source.height)
      || source.width < MIN_SIZE * 3 || source.height < MIN_SIZE * 3) {
      fail("原稿宽高至少需要 0.03 px，才能划分九个区域。");
    }
    if (!source.visible) fail("请先显示原稿图层。");
    if (source.isMask) fail("请选中包含蒙版及内容的整个组，而不是单独的蒙版。");
    let count = 0;
    visit(source, node => {
      count += 1;
      if (count > MAX_NODES) fail("原稿超过 2,000 个图层，请先选择较小的图形组。");
      if (!SUPPORTED.has(node.type)) {
        const advice = node.type === "TEXT" ? "请先在原稿副本中将文字转为轮廓。"
          : ["INSTANCE", "COMPONENT", "COMPONENT_SET"].includes(node.type)
            ? "请先在副本中分离实例或将组件转为普通 Frame。"
            : "请选中普通 Frame、组或矢量图形。";
        fail(`「${node.name}」含有不支持的 ${node.type} 图层。${advice}`);
      }
      if ("layoutMode" in node && node.layoutMode !== "NONE") {
        fail(`「${node.name}」使用了自动布局。请在副本中移除自动布局，再生成九宫格。`);
      }
      // Native constraints cannot represent a general skew across nested rotated frames.
      const t = node.relativeTransform;
      if (t && (Math.abs(t[0][0] - 1) > 0.00001 || Math.abs(t[0][1]) > 0.00001
        || Math.abs(t[1][0]) > 0.00001 || Math.abs(t[1][1] - 1) > 0.00001)) {
        fail(`「${node.name}」含有旋转或翻转。请在副本中整理为未旋转的矢量后再试。`);
      }
    });
    return count;
  }

  function validateInsets(width, height, input) {
    if (!input || typeof input !== "object") fail("切线数据不完整，请重试。");
    const insets = {};
    for (const side of ["top", "right", "bottom", "left"]) {
      const value = input[side];
      if (typeof value !== "number" || !Number.isFinite(value) || value < MIN_SIZE) {
        fail("每条边距至少需要 0.01 px。");
      }
      insets[side] = value;
    }
    if (width - insets.left - insets.right < MIN_SIZE - 1e-8
      || height - insets.top - insets.bottom < MIN_SIZE - 1e-8) {
      fail("两侧边距之和过大，中心区域的宽高至少需要 0.01 px。");
    }
    return insets;
  }

  function defaultInsets(width, height) {
    const third = value => Math.max(MIN_SIZE, Math.floor(value / 3 * 100) / 100);
    return { top: third(height), right: third(width), bottom: third(height), left: third(width) };
  }

  function planSlices(width, height, input) {
    const { top, right, bottom, left } = validateInsets(width, height, input);
    const xs = [0, left, width - right, width];
    const ys = [0, top, height - bottom, height];
    return DIRECTIONS.map(([symbol, label, horizontal, vertical], index) => {
      const col = index % 3, row = Math.floor(index / 3);
      return {
        symbol, label, x: xs[col], y: ys[row],
        width: xs[col + 1] - xs[col], height: ys[row + 1] - ys[row],
        constraints: { horizontal, vertical },
        contentConstraints: {
          horizontal: horizontal === "STRETCH" ? "SCALE" : "MIN",
          vertical: vertical === "STRETCH" ? "SCALE" : "MIN"
        }
      };
    });
  }

  function prepareClone(node, constraints) {
    visit(node, child => {
      if ("constraints" in child) child.constraints = { ...constraints };
      if ("locked" in child) child.locked = false;
      if ("minWidth" in child && child.minWidth !== null) child.minWidth = null;
      if ("maxWidth" in child && child.maxWidth !== null) child.maxWidth = null;
      if ("minHeight" in child && child.minHeight !== null) child.minHeight = null;
      if ("maxHeight" in child && child.maxHeight !== null) child.maxHeight = null;
    });
  }

  function emptyFrame(api, name, width, height, clip) {
    const frame = api.createFrame();
    frame.name = name;
    frame.fills = [];
    frame.strokes = [];
    frame.clipsContent = clip;
    frame.resizeWithoutConstraints(width, height);
    return frame;
  }

  function placeOutput(api, root, source) {
    let x = source.absoluteTransform[0][2] + source.width + 48;
    const y = source.absoluteTransform[1][2];
    // Keep the result outside clipping ancestors, instances, and existing page artwork.
    const obstacles = api.currentPage.children.filter(node => node.id !== root.id && node.visible)
      .map(node => node.absoluteBoundingBox).filter(Boolean);
    for (let pass = 0; pass <= obstacles.length; pass += 1) {
      const hits = obstacles.filter(box => x < box.x + box.width + 16
        && x + root.width + 16 > box.x && y < box.y + box.height + 16
        && y + root.height + 16 > box.y);
      if (!hits.length) break;
      x = Math.max(...hits.map(box => box.x + box.width + 48));
    }
    root.x = x;
    root.y = y;
  }

  function createNineSlice(api, source, input, options = {}) {
    validateSource(source);
    const insets = validateInsets(source.width, source.height, input);
    const slices = planSlices(source.width, source.height, insets);
    const parent = options.parent || api.currentPage;
    let root;
    let orphanClone;
    try {
      root = emptyFrame(api, `${source.name}_9slice`, source.width, source.height, true);
      parent.appendChild(root);
      placeOutput(api, root, source);
      root.constraints = { horizontal: "MIN", vertical: "MIN" };
      for (const part of slices) {
        const clip = emptyFrame(api, `${part.symbol}·${part.label}`, part.width, part.height, true);
        root.appendChild(clip);
        clip.x = part.x;
        clip.y = part.y;
        clip.constraints = part.constraints;

        orphanClone = source.clone();
        clip.appendChild(orphanClone);
        orphanClone.relativeTransform = [[1, 0, -part.x], [0, 1, -part.y]];
        prepareClone(orphanClone, part.contentConstraints);
        orphanClone = null;
      }
      const bounds = api.createRectangle();
      root.appendChild(bounds);
      bounds.name = "透明矩形";
      bounds.resizeWithoutConstraints(root.width, root.height);
      bounds.x = 0;
      bounds.y = 0;
      bounds.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 }];
      bounds.opacity = 0;
      bounds.strokes = [];
      bounds.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
      if (options.metadata !== false) {
        root.setPluginData(META_KEY, JSON.stringify({ version: 1, sourceId: source.id, insets }));
      }
      return root;
    } catch (error) {
      if (orphanClone && !orphanClone.removed) orphanClone.remove();
      if (root && !root.removed) root.remove();
      throw error;
    }
  }

  function start(api, html) {
    api.showUI(html, { width: 640, height: 720, themeColors: true, title: "矢量九宫格" });
    let revision = 0;
    let active = null;
    let generatedId = null;
    let busy = false;
    let mutating = false;
    let timer;
    let changed = false;
    let readingId = null;
    let trackedIds = new Set();
    const post = data => api.ui.postMessage(data);
    const message = error => error instanceof Error ? error.message : String(error);

    async function syncSelection() {
      const token = ++revision;
      active = null;
      readingId = null;
      trackedIds = new Set();
      changed = false;
      const selection = api.currentPage.selection;
      if (selection.length !== 1) {
        post({ type: "selection-error", message: "请在画布中选择一个矢量、组或普通 Frame。" });
        return;
      }
      let source = selection[0];
      let savedInsets;
      try {
        const meta = source.getPluginData(META_KEY);
        if (meta) {
          const saved = JSON.parse(meta);
          source = await api.getNodeByIdAsync(saved.sourceId);
          savedInsets = saved.insets;
          if (!source) fail("这份九宫格的原稿已被移除，请重新选择原稿。");
        }
        if (token !== revision) return;
        validateSource(source);
        readingId = source.id;
        visit(source, node => trackedIds.add(node.id));
        let ancestor = source.parent;
        while (ancestor && ancestor.type !== "PAGE") { trackedIds.add(ancestor.id); ancestor = ancestor.parent; }
        if (!ancestor || ancestor.id !== api.currentPage.id) fail("原稿已移动到其他页面，请到原稿所在页面重新选择。");
        post({ type: "loading" });
        const width = source.width, height = source.height;
        // Bound the preview cost. The exported pixels never become output layers.
        const bytes = await source.exportAsync({
          format: "PNG", constraint: { type: "SCALE", value: Math.min(8, 1000 / Math.max(width, height)) },
          useAbsoluteBounds: true
        });
        if (token !== revision || source.removed) return;
        let insets = defaultInsets(width, height);
        if (savedInsets) {
          try { insets = validateInsets(width, height, savedInsets); } catch (_) { /* use thirds */ }
        }
        active = { nodeId: source.id, revision: token, width, height };
        post({ type: "selection", ...active, name: source.name, bytes, insets });
      } catch (error) {
        if (token === revision) post({ type: "selection-error", message: message(error) });
      } finally {
        if (token === revision) readingId = null;
      }
    }

    api.on("selectionchange", () => {
      if (busy || (api.currentPage.selection.length === 1 && api.currentPage.selection[0].id === generatedId)) return;
      generatedId = null;
      readingId = null;
      revision += 1;
      active = null;
      post({ type: "loading" });
      clearTimeout(timer);
      timer = setTimeout(() => { syncSelection().catch(error => post({ type: "error", message: message(error) })); }, 100);
    });
    const onNodeChange = event => {
      const trackedId = active ? active.nodeId : readingId;
      if (mutating || !trackedId) return;
      // Invalidate only when the selected artwork or one of its descendants changes.
      if (event.nodeChanges.some(change => {
        let n = change.node;
        if (trackedIds.has(n.id)) return true;
        while (n) { if (n.id === trackedId) return true; if (n.removed) break; n = n.parent; }
        return false;
      })) {
        changed = true;
        active = null;
        readingId = null;
        revision += 1;
        post({ type: "selection-error", message: "原稿已变化，请点击刷新重新读取。" });
      }
    };
    let observedPage = api.currentPage;
    observedPage.on("nodechange", onNodeChange);
    api.on("currentpagechange", () => {
      observedPage.off("nodechange", onNodeChange);
      observedPage = api.currentPage;
      observedPage.on("nodechange", onNodeChange);
      generatedId = null;
      revision += 1;
      active = null;
      readingId = null;
      clearTimeout(timer);
      syncSelection().catch(error => post({ type: "error", message: message(error) }));
    });

    api.ui.onmessage = async data => {
      if (!data || typeof data.type !== "string" || busy) return;
      if (data.type === "ready" || data.type === "refresh") {
        changed = false;
        await syncSelection();
        return;
      }
      if (data.type !== "create") return;
      const selectionAtStart = api.currentPage.selection.map(node => node.id).join(",");
      busy = true;
      post({ type: "creating" });
      try {
        if (changed || !active || data.nodeId !== active.nodeId || data.revision !== active.revision) {
          fail("选区已变化，请刷新原稿后再生成。");
        }
        const requested = { ...active, pageId: api.currentPage.id };
        const source = await api.getNodeByIdAsync(requested.nodeId);
        if (!active || active.nodeId !== requested.nodeId || revision !== requested.revision
          || api.currentPage.id !== requested.pageId
          || api.currentPage.selection.map(node => node.id).join(",") !== selectionAtStart) {
          fail("选区或页面已变化，请重新读取原稿后再生成。");
        }
        validateSource(source);
        if (Math.abs(source.width - requested.width) > 1e-8 || Math.abs(source.height - requested.height) > 1e-8) {
          fail("原稿尺寸已变化，请刷新后再生成。");
        }
        mutating = true;
        const output = createNineSlice(api, source, data.insets);
        generatedId = output.id;
        api.currentPage.selection = [output];
        api.viewport.scrollAndZoomIntoView([output]);
        api.commitUndo();
        post({ type: "created", name: output.name, nodeId: output.id, width: output.width, height: output.height,
          message: "已生成 9 个裁切 Frame。拖动外层 Frame 的宽高即可拉伸，⌘Z 可撤销。" });
      } catch (error) {
        post({ type: "error", message: message(error) });
      } finally {
        mutating = false;
        busy = false;
        if (api.currentPage.selection.map(node => node.id).join(",") !== selectionAtStart
          && (api.currentPage.selection.length !== 1 || api.currentPage.selection[0].id !== generatedId)) {
          // A new canvas selection may arrive while node lookup was awaiting the host.
          await syncSelection();
        }
      }
    };
  }

  return { MIN_SIZE, DIRECTIONS, META_KEY, validateSource, validateInsets, defaultInsets, planSlices, createNineSlice, start };
})();

if (typeof module !== "undefined" && module.exports) module.exports = VectorNineSlice;
if (typeof figma !== "undefined" && typeof __html__ !== "undefined") VectorNineSlice.start(figma, __html__);
