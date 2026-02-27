/// <reference types="@figma/plugin-typings" />

figma.showUI(__html__, { width: 460, height: 600 });

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
        if (node.name && !componentNames.includes(node.name)) {
          componentNames.push(node.name);
        }
      } else if (node.type === "INSTANCE") {
        const main = await node.getMainComponentAsync();
        const name = main?.name ?? node.name;
        if (name && !componentNames.includes(name)) {
          componentNames.push(name);
        }
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

figma.ui.onmessage = async (msg: {
  type: string;
  componentName: string;
  apiCalls: string[];
  interactions: string[];
  additionalInfo: string;
}) => {
  // UI is ready — now safe to detect and prefill
  if (msg.type === "ready") {
    await getPageData();
    return;
  }

  if (msg.type === "create-handoff") {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    await figma.loadFontAsync({ family: "Inter", style: "Bold" });

    const FRAME_WIDTH = 660;
    const PADDING = 40;
    const CONTENT_WIDTH = FRAME_WIDTH - PADDING * 2;
    let y = PADDING;

    const frame = figma.createFrame();
    frame.name = `Handoff – ${msg.componentName || "Component"}`;
    frame.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.99 } }];
    frame.cornerRadius = 16;
    frame.resize(FRAME_WIDTH, 800);

    const addRect = (x: number, yPos: number, w: number, h: number, color: RGB, opacity = 1, radius = 0): RectangleNode => {
      const rect = figma.createRectangle();
      rect.x = x; rect.y = yPos;
      rect.resize(w, h);
      rect.fills = [{ type: "SOLID", color, opacity }];
      rect.cornerRadius = radius;
      frame.appendChild(rect);
      return rect;
    };

    const addText = (content: string, size: number, bold: boolean, color: RGB, xPos: number, yPos: number, maxWidth: number): TextNode => {
      const node = figma.createText();
      node.fontName = { family: "Inter", style: bold ? "Bold" : "Regular" };
      node.fontSize = size;
      node.fills = [{ type: "SOLID", color }];
      node.x = xPos; node.y = yPos;
      node.resize(maxWidth, 40);
      node.textAutoResize = "HEIGHT";
      node.characters = content;
      frame.appendChild(node);
      return node;
    };

    const titleNode = addText(
      msg.componentName || "Component",
      26, true, { r: 0.08, g: 0.08, b: 0.12 },
      PADDING, y, CONTENT_WIDTH
    );
    y += titleNode.height + 6;

    const subtitleNode = addText(
      "Developer Handoff",
      13, false, { r: 0.5, g: 0.5, b: 0.56 },
      PADDING, y, CONTENT_WIDTH
    );
    y += subtitleNode.height + 20;

    addRect(PADDING, y, CONTENT_WIDTH, 1, { r: 0.85, g: 0.85, b: 0.9 });
    y += 28;

    const addSection = (label: string, items: string[], accentColor: RGB) => {
      const filtered = items.filter(i => i.trim() !== "");
      if (filtered.length === 0) return;

      addRect(PADDING, y, CONTENT_WIDTH, 38, accentColor, 0.1, 10);
      addText(label, 12, true, accentColor, PADDING + 14, y + 12, CONTENT_WIDTH - 28);
      y += 50;

      filtered.forEach((item, i) => {
        const bulletNode = addText(`${i + 1}.`, 13, true, accentColor, PADDING + 8, y, 24);
        const itemNode = addText(item, 13, false, { r: 0.15, g: 0.15, b: 0.22 }, PADDING + 32, y, CONTENT_WIDTH - 32);
        y += Math.max(bulletNode.height, itemNode.height) + 12;
      });

      y += 20;
    };

    addSection("⚡  API Calls", msg.apiCalls, { r: 0.24, g: 0.43, b: 0.98 });
    addSection("🖱  Interactions", msg.interactions, { r: 0.06, g: 0.62, b: 0.42 });
    addSection("📋  Additional Information", [msg.additionalInfo], { r: 0.85, g: 0.45, b: 0.05 });

    frame.resize(FRAME_WIDTH, y + PADDING);
    figma.currentPage.appendChild(frame);
    figma.viewport.scrollAndZoomIntoView([frame]);
    figma.notify("Handoff template created ✅");
    figma.closePlugin();
  }
};