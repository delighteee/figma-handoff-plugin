/// <reference types="@figma/plugin-typings" />

figma.showUI(__html__, { width: 480, height: 700 });

async function getPageData() {
  const selection = figma.currentPage.selection;

  if (selection.length === 0 || selection[0].type !== "FRAME") {
    figma.ui.postMessage({
      type: "prefill",
      pageName: "",
      interactions: [],
      componentNames: [],
      error: selection.length === 0
        ? "No frame selected. Please select a frame first."
        : "Selection is not a frame. Please select a frame.",
    });
    return;
  }

  const selectedFrame = selection[0] as FrameNode;
  const componentNames: string[] = [];

  const walk = async (nodes: readonly SceneNode[]) => {
    for (const node of nodes) {
      if (node.type === "COMPONENT") {
        if (node.name && !componentNames.includes(node.name))
          componentNames.push(node.name);
      } else if (node.type === "INSTANCE") {
        const main = await node.getMainComponentAsync();
        const name = main?.name ?? node.name;
        if (name && !componentNames.includes(name))
          componentNames.push(name);
      }
      if ("children" in node) await walk(node.children);
    }
  };

  await walk(selectedFrame.children);

  figma.ui.postMessage({
    type: "prefill",
    pageName: selectedFrame.name,
    interactions: componentNames.map(name => `Tap ${name} → `),
    componentNames,
    error: null,
  });
}

figma.on("selectionchange", () => { getPageData(); });

// ── Canvas rendering ──────────────────────────────────────────────

type HandoffMsg = {
  type: string;
  // Screen Identity
  screenName: string;
  screenType: string;
  pageSection: string;
  // API & Data
  apiCalls: string[];
  dataStates: string[];
  // Interactions & Navigation
  interactions: string[];
  gestures: string[];
  // Component Notes
  componentNotes: string[];
  // States
  statesToBuild: string[];
  // Business Logic
  businessLogic: string[];
  // Assets & Tokens
  assets: string[];
  // Accessibility
  accessibility: string[];
  // Analytics
  analytics: string[];
  // Additional
  additionalInfo: string;
};

figma.ui.onmessage = async (msg: HandoffMsg) => {
  if (msg.type === "ready") {
    await getPageData();
    return;
  }

  if (msg.type !== "create-handoff") return;

  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });

  const FRAME_WIDTH = 700;
  const PADDING = 40;
  const COL = FRAME_WIDTH - PADDING * 2;
  let y = PADDING;

  const frame = figma.createFrame();
  frame.name = `Handoff – ${msg.screenName || "Screen"}`;
  frame.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.99 } }];
  frame.cornerRadius = 16;
  frame.resize(FRAME_WIDTH, 2000);

  const addRect = (x: number, yp: number, w: number, h: number, color: RGB, opacity = 1, radius = 0) => {
    const r = figma.createRectangle();
    r.x = x; r.y = yp; r.resize(w, h);
    r.fills = [{ type: "SOLID", color, opacity }];
    r.cornerRadius = radius;
    frame.appendChild(r);
    return r;
  };

  const addText = (content: string, size: number, bold: boolean, color: RGB, x: number, yp: number, w: number): TextNode => {
    const t = figma.createText();
    t.fontName = { family: "Inter", style: bold ? "Bold" : "Regular" };
    t.fontSize = size; t.fills = [{ type: "SOLID", color }];
    t.x = x; t.y = yp; t.resize(w, 40); t.textAutoResize = "HEIGHT";
    t.characters = content;
    frame.appendChild(t);
    return t;
  };

  // ── Header ──
  const titleNode = addText(msg.screenName || "Screen", 28, true, { r: 0.08, g: 0.08, b: 0.12 }, PADDING, y, COL);
  y += titleNode.height + 4;

  const meta = [msg.screenType, msg.pageSection].filter(Boolean).join("  ·  ");
  if (meta) {
    const metaNode = addText(meta, 12, false, { r: 0.5, g: 0.5, b: 0.6 }, PADDING, y, COL);
    y += metaNode.height + 4;
  }

  const subtitleNode = addText("Developer Handoff", 13, false, { r: 0.6, g: 0.6, b: 0.66 }, PADDING, y, COL);
  y += subtitleNode.height + 18;
  addRect(PADDING, y, COL, 1, { r: 0.82, g: 0.82, b: 0.88 });
  y += 28;

  // ── Section builder ──
  const SECTIONS: { label: string; items: string[]; color: RGB }[] = [
    { label: "⚡  API & Data",             items: [...msg.apiCalls, ...msg.dataStates],    color: { r: 0.24, g: 0.43, b: 0.98 } },
    { label: "🖱  Interactions & Navigation", items: [...msg.interactions, ...msg.gestures], color: { r: 0.06, g: 0.62, b: 0.42 } },
    { label: "🧩  Component Notes",         items: msg.componentNotes,                     color: { r: 0.55, g: 0.22, b: 0.95 } },
    { label: "🔀  States to Build",         items: msg.statesToBuild,                      color: { r: 0.9,  g: 0.35, b: 0.1  } },
    { label: "⚙️  Business Logic",          items: msg.businessLogic,                      color: { r: 0.1,  g: 0.55, b: 0.72 } },
    { label: "🖼  Assets & Tokens",         items: msg.assets,                             color: { r: 0.7,  g: 0.4,  b: 0.1  } },
    { label: "♿  Accessibility",           items: msg.accessibility,                      color: { r: 0.15, g: 0.6,  b: 0.45 } },
    { label: "📊  Analytics",              items: msg.analytics,                          color: { r: 0.85, g: 0.22, b: 0.45 } },
    { label: "📋  Additional Information", items: msg.additionalInfo ? [msg.additionalInfo] : [], color: { r: 0.4, g: 0.4, b: 0.46 } },
  ];

  for (const section of SECTIONS) {
    const filtered = section.items.filter(i => i.trim() !== "");
    if (filtered.length === 0) continue;

    addRect(PADDING, y, COL, 36, section.color, 0.1, 10);
    addText(section.label, 11, true, section.color, PADDING + 14, y + 12, COL - 28);
    y += 48;

    for (let i = 0; i < filtered.length; i++) {
      const bullet = addText(`${i + 1}.`, 13, true, section.color, PADDING + 8, y, 24);
      const item   = addText(filtered[i], 13, false, { r: 0.15, g: 0.15, b: 0.22 }, PADDING + 32, y, COL - 32);
      y += Math.max(bullet.height, item.height) + 10;
    }
    y += 18;
  }

  frame.resize(FRAME_WIDTH, y + PADDING);
  figma.currentPage.appendChild(frame);
  figma.viewport.scrollAndZoomIntoView([frame]);
  figma.notify("Handoff created ✅");
  figma.closePlugin();
};