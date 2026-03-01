/// <reference types="@figma/plugin-typings" />

figma.showUI(__html__, { width: 480, height: 700 });

let lastSelectedFrameId: string | null = null;

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
    // ✅ Do NOT clear lastSelectedFrameId here — keep the last valid one
    return;
  }

  const selectedFrame = selection[0] as FrameNode;
  lastSelectedFrameId = selectedFrame.id; // only update on valid frame
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

type HandoffMsg = {
  type: string;
  screenName: string;
  screenType: string;
  pageSection: string;
  apiCalls: string[];
  dataStates: string[];
  interactions: string[];
  gestures: string[];
  componentNotes: string[];
  statesToBuild: string[];
  businessLogic: string[];
  assets: string[];
  accessibility: string[];
  analytics: string[];
  additionalInfo: string;
};

figma.ui.onmessage = async (msg: HandoffMsg) => {
  if (msg.type === "ready") {
    await getPageData();
    return;
  }

  if (msg.type !== "create-handoff") return;

  // ✅ Grab source frame immediately before anything else
  const sourceNode = lastSelectedFrameId
    ? (figma.getNodeById(lastSelectedFrameId) as FrameNode | null)
    : null;

  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });

  const FRAME_WIDTH = 680;
  const PADDING = 32;
  const INNER_WIDTH = FRAME_WIDTH - PADDING * 2;

  const makeVFrame = (name: string, gap: number, padH = 0, padV = 0, bg?: RGB): FrameNode => {
    const f = figma.createFrame();
    f.name = name;
    f.layoutMode = "VERTICAL";
    f.primaryAxisSizingMode = "AUTO";
    f.counterAxisSizingMode = "FIXED";
    f.resize(INNER_WIDTH, 50);
    f.itemSpacing = gap;
    f.paddingLeft = padH;
    f.paddingRight = padH;
    f.paddingTop = padV;
    f.paddingBottom = padV;
    f.fills = bg ? [{ type: "SOLID", color: bg }] : [];
    f.layoutAlign = "STRETCH";
    return f;
  };

  const makeText = (content: string, size: number, bold: boolean, color: RGB): TextNode => {
    const t = figma.createText();
    t.fontName = { family: "Inter", style: bold ? "Bold" : "Regular" };
    t.fontSize = size;
    t.fills = [{ type: "SOLID", color }];
    t.characters = content;
    t.layoutAlign = "STRETCH";
    t.textAutoResize = "HEIGHT";
    return t;
  };

  const root = figma.createFrame();
  root.name = `Handoff – ${msg.screenName || "Screen"}`;
  root.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.99 } }];
  root.cornerRadius = 16;
  root.layoutMode = "VERTICAL";
  root.primaryAxisSizingMode = "AUTO";
  root.counterAxisSizingMode = "FIXED";
  root.resize(FRAME_WIDTH, 100);
  root.paddingTop = PADDING;
  root.paddingBottom = PADDING;
  root.paddingLeft = PADDING;
  root.paddingRight = PADDING;
  root.itemSpacing = 12;

  // Header
  const header = makeVFrame("Header", 4);
  header.appendChild(makeText(msg.screenName || "Screen", 26, true, { r: 0.08, g: 0.08, b: 0.12 }));
  const meta = [msg.screenType, msg.pageSection].filter(Boolean).join("  ·  ");
  if (meta) header.appendChild(makeText(meta, 12, false, { r: 0.5, g: 0.5, b: 0.6 }));
  header.appendChild(makeText("Developer Handoff", 12, false, { r: 0.65, g: 0.65, b: 0.7 }));
  root.appendChild(header);

  // Divider
  const divider = figma.createRectangle();
  divider.name = "Divider";
  divider.resize(INNER_WIDTH, 1);
  divider.fills = [{ type: "SOLID", color: { r: 0.82, g: 0.82, b: 0.88 } }];
  divider.layoutAlign = "STRETCH";
  root.appendChild(divider);

  const addSection = (label: string, items: string[], color: RGB) => {
    const filtered = items.filter(i => i.trim() !== "");
    if (filtered.length === 0) return;

    const section = figma.createFrame();
    section.name = label;
    section.layoutMode = "VERTICAL";
    section.primaryAxisSizingMode = "AUTO";
    section.counterAxisSizingMode = "FIXED";
    section.resize(INNER_WIDTH, 50);
    section.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    section.cornerRadius = 10;
    section.itemSpacing = 0;
    section.layoutAlign = "STRETCH";
    section.clipsContent = true;

    const sectionHeader = figma.createFrame();
    sectionHeader.name = "Label";
    sectionHeader.layoutMode = "VERTICAL";
    sectionHeader.primaryAxisSizingMode = "AUTO";
    sectionHeader.counterAxisSizingMode = "FIXED";
    sectionHeader.resize(INNER_WIDTH, 50);
    sectionHeader.fills = [{ type: "SOLID", color, opacity: 0.08 } as SolidPaint];
    sectionHeader.paddingLeft = 14;
    sectionHeader.paddingRight = 14;
    sectionHeader.paddingTop = 10;
    sectionHeader.paddingBottom = 10;
    sectionHeader.layoutAlign = "STRETCH";
    sectionHeader.appendChild(makeText(label, 11, true, color));
    section.appendChild(sectionHeader);

    const itemsWrap = makeVFrame("Items", 8, 14, 12);
    itemsWrap.paddingBottom = 14;

    filtered.forEach((item, i) => {
      const row = figma.createFrame();
      row.name = `Row ${i + 1}`;
      row.layoutMode = "HORIZONTAL";
      row.primaryAxisSizingMode = "AUTO";
      row.counterAxisSizingMode = "AUTO";
      row.fills = [];
      row.itemSpacing = 8;
      row.layoutAlign = "STRETCH";
      row.counterAxisAlignItems = "MIN";

      const bullet = figma.createText();
      bullet.fontName = { family: "Inter", style: "Bold" };
      bullet.fontSize = 12;
      bullet.fills = [{ type: "SOLID", color }];
      bullet.characters = `${i + 1}.`;
      bullet.textAutoResize = "WIDTH_AND_HEIGHT";

      const itemText = figma.createText();
      itemText.fontName = { family: "Inter", style: "Regular" };
      itemText.fontSize = 13;
      itemText.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.15, b: 0.22 } }];
      itemText.characters = item;
      itemText.layoutGrow = 1;
      itemText.textAutoResize = "HEIGHT";

      row.appendChild(bullet);
      row.appendChild(itemText);
      itemsWrap.appendChild(row);
    });

    section.appendChild(itemsWrap);
    root.appendChild(section);
  };

  const SECTIONS = [
    { label: "API & Data",                items: [...msg.apiCalls, ...msg.dataStates],    color: { r: 0.24, g: 0.43, b: 0.98 } },
    { label: "Interactions & Navigation",  items: [...msg.interactions, ...msg.gestures],  color: { r: 0.06, g: 0.62, b: 0.42 } },
    { label: "Component Notes",            items: msg.componentNotes,                      color: { r: 0.55, g: 0.22, b: 0.95 } },
    { label: "States to Build",            items: msg.statesToBuild,                       color: { r: 0.9,  g: 0.35, b: 0.1  } },
    { label: "Business Logic",             items: msg.businessLogic,                       color: { r: 0.1,  g: 0.55, b: 0.72 } },
    { label: "Assets & Tokens",            items: msg.assets,                              color: { r: 0.7,  g: 0.4,  b: 0.1  } },
    { label: "Accessibility",              items: msg.accessibility,                       color: { r: 0.15, g: 0.6,  b: 0.45 } },
    { label: "Analytics",                 items: msg.analytics,                           color: { r: 0.85, g: 0.22, b: 0.45 } },
    { label: "Additional Info",            items: msg.additionalInfo ? [msg.additionalInfo] : [], color: { r: 0.4, g: 0.4, b: 0.46 } },
  ];

  for (const s of SECTIONS) addSection(s.label, s.items, s.color as RGB);

  // ✅ Position next to source frame and append BEFORE creating connector
  if (sourceNode) {
    root.x = sourceNode.x + sourceNode.width + 120;
    root.y = sourceNode.y;
  }

  figma.currentPage.appendChild(root);

  // ✅ Connector — both nodes must be on canvas first
  if (sourceNode) {
    try {
      const connector = figma.createConnector();
      figma.currentPage.appendChild(connector);
      connector.connectorStart = { endpointNodeId: sourceNode.id, magnet: "RIGHT" };
      connector.connectorEnd   = { endpointNodeId: root.id, magnet: "LEFT" };
      connector.strokeWeight = 2;
      connector.strokes = [{ type: "SOLID", color: { r: 0.24, g: 0.43, b: 0.98 } }];
      connector.connectorStartStrokeCap = "NONE";
      connector.connectorEndStrokeCap = "ARROW_EQUILATERAL";
    } catch (e) {
      console.error("Connector error:", e);
    }
  }

  figma.viewport.scrollAndZoomIntoView(sourceNode ? [sourceNode, root] : [root]);
  figma.notify("Handoff created ✅");
  figma.closePlugin();
};