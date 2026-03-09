/// <reference types="@figma/plugin-typings" />

figma.showUI(__html__, { width: 480, height: 700 });

let lastSelectedFrameId: string | null = null;

// DM Mono for the header title — falls back to Inter Bold if not available in the file
let titleFont: FontName = { family: "Inter", style: "Bold" };

// Inter is always available in Figma; load DM Mono separately so its failure
// never blocks the rest of the plugin or rejects fontPromise.
const fontPromise = Promise.all([
  figma.loadFontAsync({ family: "Inter", style: "Regular" }),
  figma.loadFontAsync({ family: "Inter", style: "Bold" }),
]);

figma.loadFontAsync({ family: "DM Mono", style: "Medium" })
  .then(() => { titleFont = { family: "DM Mono", style: "Medium" }; })
  .catch(() => { /* DM Mono unavailable — Inter Bold fallback stays */ });

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
    figma.ui.postMessage({ type: "suggestions", items: [] });
    return;
  }

  const selectedFrame = selection[0] as FrameNode;
  lastSelectedFrameId = selectedFrame.id;

  // findAllWithCriteria is synchronous and internally optimised by Figma —
  // no async calls, no per-node round trips. Instance names match their
  // main component name in the vast majority of cases.
  const seen = new Set<string>();
  const componentNames: string[] = [];
  const nodes = selectedFrame.findAllWithCriteria({ types: ["INSTANCE", "COMPONENT"] });
  for (const node of nodes) {
    if (node.name && !seen.has(node.name)) {
      seen.add(node.name);
      componentNames.push(node.name);
    }
  }

  figma.ui.postMessage({
    type: "prefill",
    frameId: selectedFrame.id,
    pageName: selectedFrame.name,
    interactions: componentNames.map(name => `Tap ${name} → `),
    componentNames,
    error: null,
  });

  figma.ui.postMessage({ type: "suggestions", items: await scanForIssues(selectedFrame) });
}

type Issue = { id: string; category: "design" | "a11y" | "ux"; message: string; nodeIds?: string[]; nodeNames?: string[] };

async function scanForIssues(frame: FrameNode): Promise<Issue[]> {
  const issues: Issue[] = [];
  let n = 0;
  const nextId = () => String(n++);

  const [paintStyles, textStyles] = await Promise.all([
    figma.getLocalPaintStylesAsync(),
    figma.getLocalTextStylesAsync(),
  ]);

  const ref = (nodes: SceneNode[], cap = 20) => ({
    nodeIds:   nodes.slice(0, cap).map(n => n.id),
    nodeNames: nodes.slice(0, cap).map(n => n.name),
  });

  // Only flag nodes that are directly editable on this frame:
  // visible, not locked, and not nested inside a component instance
  // (instance children must be fixed in the main component, not here)
  const isInsideInstance = (node: SceneNode): boolean => {
    let p: BaseNode | null = node.parent;
    while (p !== null && p.id !== frame.id) {
      if (p.type === "INSTANCE") return true;
      p = p.parent;
    }
    return false;
  };
  const editable = (n: SceneNode) =>
    n.visible !== false && !n.locked && !isInsideInstance(n);
  // ── Text checks ──────────────────────────────────────────────
  const textNodes = (frame.findAllWithCriteria({ types: ["TEXT"] }) as TextNode[]).filter(editable);

  if (textStyles.length > 0) {
    const unstyled = textNodes.filter(t => !t.textStyleId || t.textStyleId === figma.mixed);
    if (unstyled.length > 0)
      issues.push({ id: nextId(), category: "design",
        message: `${unstyled.length} text layer${unstyled.length > 1 ? "s" : ""} not linked to a text style`,
        ...ref(unstyled) });
  }

  const smallText = textNodes.filter(t => typeof t.fontSize === "number" && (t.fontSize as number) < 11);
  if (smallText.length > 0)
    issues.push({ id: nextId(), category: "a11y",
      message: `${smallText.length} text layer${smallText.length > 1 ? "s use" : " uses"} font size < 11px — may be unreadable`,
      ...ref(smallText) });

  // ── Fill style checks ─────────────────────────────────────────
  if (paintStyles.length > 0) {
    // Only RECTANGLE and ELLIPSE — FRAME nodes are structural layout containers,
    // INSTANCE/COMPONENT fills are managed via the component itself
    const fillable = frame.findAllWithCriteria({ types: ["RECTANGLE", "ELLIPSE"] }).filter(editable);
    const unstyledFills = fillable.filter(node => {
      const fills = (node as GeometryMixin).fills;
      if (!fills || fills === figma.mixed) return false;
      const visibleFills = (fills as ReadonlyArray<Paint>).filter(f => f.visible !== false);
      if (visibleFills.length === 0) return false;
      const styleId = (node as { fillStyleId?: string | symbol }).fillStyleId;
      return !styleId || styleId === figma.mixed;
    });
    if (unstyledFills.length > 0)
      issues.push({ id: nextId(), category: "design",
        message: `${unstyledFills.length} layer${unstyledFills.length > 1 ? "s use" : " uses"} raw fill colors — not from the style library`,
        ...ref(unstyledFills as SceneNode[]) });
  }

  // ── Touch target checks ───────────────────────────────────────
  // Instances: filter by visible only (UX/a11y checks are observational,
  // not about direct editing — a hidden component is simply excluded)
  const instances = (frame.findAllWithCriteria({ types: ["INSTANCE"] }) as InstanceNode[])
    .filter(n => n.visible !== false && !n.locked);
  const interactiveKw = ["button", "btn", "tab", "icon", "chip", "toggle", "checkbox", "radio", "fab", "cta"];
  const smallTargets = instances.filter(inst => {
    const name = inst.name.toLowerCase();
    return interactiveKw.some(k => name.includes(k)) && (inst.width < 44 || inst.height < 44);
  });
  if (smallTargets.length > 0)
    issues.push({ id: nextId(), category: "a11y",
      message: `${smallTargets.length} interactive component${smallTargets.length > 1 ? "s" : ""} may have touch targets below 44pt`,
      ...ref(smallTargets) });

  // ── UX Heuristics checks ──────────────────────────────────────

  // H1 — Visibility of system status
  const dataInsts = instances.filter(inst =>
    ["list", "grid", "table", "feed", "card"].some(k => inst.name.toLowerCase().includes(k)));
  const hasLoadingState = instances.some(inst =>
    ["loading", "skeleton", "spinner", "shimmer", "progress"].some(k => inst.name.toLowerCase().includes(k)));
  if (dataInsts.length > 0 && !hasLoadingState)
    issues.push({ id: nextId(), category: "ux",
      message: "Data list/grid present but no loading or skeleton state found — users need feedback while content loads (Nielsen #1)",
      ...ref(dataInsts) });

  // H3 — User control and freedom: destructive action without confirm/undo
  const destructiveKw = ["delete", "remove", "discard", "clear", "reset"];
  const confirmKw     = ["confirm", "undo", "cancel", "are you sure", "warning"];
  const destructiveInsts = instances.filter(inst =>
    destructiveKw.some(k => inst.name.toLowerCase().includes(k)));
  if (destructiveInsts.length > 0) {
    const hasConfirmInst = instances.some(inst => confirmKw.some(k => inst.name.toLowerCase().includes(k)));
    const hasConfirmText = textNodes.some(t => {
      const chars = typeof t.characters === "string" ? t.characters.toLowerCase() : "";
      return confirmKw.some(k => chars.includes(k));
    });
    if (!hasConfirmInst && !hasConfirmText)
      issues.push({ id: nextId(), category: "ux",
        message: "Destructive action (delete/remove) detected with no visible confirmation or undo — users need an escape hatch (Nielsen #3)",
        ...ref(destructiveInsts) });
  }

  // H4 — Consistency and standards: multiple primary CTAs
  const primaryKw = ["button/primary", "btn-primary", "/primary", "cta", "filled button", "contained button"];
  const primaryCtaInsts = instances.filter(inst =>
    primaryKw.some(k => inst.name.toLowerCase().includes(k)));
  if (primaryCtaInsts.length > 1)
    issues.push({ id: nextId(), category: "ux",
      message: `${primaryCtaInsts.length} primary CTA buttons found — a single dominant action reduces cognitive load (Nielsen #4)`,
      ...ref(primaryCtaInsts) });

  // H5 — Error prevention: form inputs with no error state
  const formInputInsts = instances.filter(inst =>
    ["input", "text field", "textfield", "field", "form"].some(k => inst.name.toLowerCase().includes(k)));
  const hasErrorState = instances.some(inst =>
    ["error", "validation", "invalid", "required"].some(k => inst.name.toLowerCase().includes(k)));
  if (formInputInsts.length > 0 && !hasErrorState)
    issues.push({ id: nextId(), category: "ux",
      message: "Form inputs found but no error/validation state components — consider showing inline validation (Nielsen #5)",
      ...ref(formInputInsts) });

  // H6 — Recognition rather than recall: icon-only buttons
  const iconOnlyKw = ["icon button", "icon-btn", "icon/button", "fab", "icon only"];
  const unlabelledIcons = instances.filter(inst => {
    if (!iconOnlyKw.some(k => inst.name.toLowerCase().includes(k))) return false;
    return !inst.findAllWithCriteria({ types: ["TEXT"] }).some(
      t => (t as TextNode).characters && (t as TextNode).characters.trim().length > 0);
  });
  if (unlabelledIcons.length > 0)
    issues.push({ id: nextId(), category: "ux",
      message: `${unlabelledIcons.length} icon-only button${unlabelledIcons.length > 1 ? "s" : ""} with no visible label — consider a tooltip or label (Nielsen #6)`,
      ...ref(unlabelledIcons) });

  // H8 — Aesthetic and minimalist design: excessive text density
  const denseText = textNodes.filter(t => typeof t.fontSize === "number" && (t.fontSize as number) <= 12);
  if (denseText.length > 20)
    issues.push({ id: nextId(), category: "ux",
      message: `${denseText.length} small text layers (≤12px) — high text density may hurt readability; consider progressive disclosure (Nielsen #8)`,
      ...ref(denseText) });

  // H3 — Sub-screen with no back/close navigation
  const frameLower = frame.name.toLowerCase();
  const isSubScreen = ["modal", "sheet", "dialog", "drawer", "overlay", "detail", "popup"].some(k => frameLower.includes(k));
  if (isSubScreen) {
    const hasExit = instances.some(inst =>
      ["back", "close", "dismiss", "arrow-left", "chevron-left", "nav-back"].some(k => inst.name.toLowerCase().includes(k)));
    if (!hasExit)
      issues.push({ id: nextId(), category: "ux",
        message: `"${frame.name}" looks like a sub-screen but has no back or close navigation — users need a clear exit (Nielsen #3)`,
        nodeIds: [frame.id], nodeNames: [frame.name] });
  }

  return issues;
}

figma.on("selectionchange", getPageData);

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
  nodeIds?: string[];
};

figma.ui.onmessage = async (msg: HandoffMsg) => {
  if (msg.type === "ready") {
    getPageData();
    return;
  }

  if (msg.type === "show-nodes") {
    const nodeIds: string[] = msg.nodeIds || [];
    const resolved = (await Promise.all(nodeIds.map(id => figma.getNodeByIdAsync(id))))
      .filter((n): n is SceneNode => n !== null && "visible" in n);
    if (resolved.length > 0) {
      figma.viewport.scrollAndZoomIntoView(resolved);
    }
    return;
  }

  if (msg.type !== "create-handoff") return;

  try {
  const sourceNode = lastSelectedFrameId
    ? (await figma.getNodeByIdAsync(lastSelectedFrameId) as FrameNode | null)
    : null;

  // Fonts are already loading since plugin open — this await is near-instant
  await fontPromise;

  // Match the handoff width to the source frame, fall back to 680
  const FRAME_WIDTH = sourceNode ? sourceNode.width : 680;
  const PADDING = 32;

  const makeVFrame = (name: string, gap: number, padH = 0, padV = 0, bg?: RGB): FrameNode => {
    const f = figma.createFrame();
    f.name = name;
    f.layoutMode = "VERTICAL";
    f.primaryAxisSizingMode = "AUTO"; // height hugs content — no fixed height
    f.counterAxisSizingMode = "AUTO"; // width from layoutAlign STRETCH — no fixed width
    f.itemSpacing = gap;
    f.paddingLeft = padH;
    f.paddingRight = padH;
    f.paddingTop = padV;
    f.paddingBottom = padV;
    f.fills = bg ? [{ type: "SOLID", color: bg }] : [];
    f.layoutAlign = "STRETCH";        // fills parent's available width
    return f;                         // no resize() — zero fixed dimensions
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

  // Dark mode canvas palette (Radix Slate dark)
  const C = {
    bg:      { r: 0.067, g: 0.067, b: 0.075 }, // slate-1  #111113
    panel:   { r: 0.094, g: 0.098, b: 0.106 }, // slate-2  #18191b
    border:  { r: 0.212, g: 0.227, b: 0.247 }, // slate-6  #363a3f
    textLo:  { r: 0.412, g: 0.431, b: 0.467 }, // slate-9  #696e77
    textHi:  { r: 0.929, g: 0.933, b: 0.941 }, // slate-12 #edeef0
  };

  const root = figma.createFrame();
  root.name = `Handoff – ${msg.screenName || "Screen"}`;
  root.fills = [{ type: "SOLID", color: C.bg }];
  root.cornerRadius = 0;
  root.layoutMode = "VERTICAL";
  root.counterAxisSizingMode = "FIXED";
  root.resize(FRAME_WIDTH, 100); // set width; height overridden by AUTO below
  root.primaryAxisSizingMode = "AUTO"; // must be set AFTER resize() or resize locks height
  root.paddingTop = PADDING;
  root.paddingBottom = PADDING;
  root.paddingLeft = PADDING;
  root.paddingRight = PADDING;
  root.itemSpacing = 12;

  // Header
  const header = makeVFrame("Header", 4);
  const titleText = figma.createText();
  titleText.fontName = titleFont;
  titleText.fontSize = 26;
  titleText.fills = [{ type: "SOLID", color: C.textHi }];
  titleText.characters = msg.screenName || "Screen";
  titleText.layoutAlign = "STRETCH";
  titleText.textAutoResize = "HEIGHT";
  header.appendChild(titleText);
  const meta = [msg.screenType, msg.pageSection].filter(Boolean).join("  ·  ");
  if (meta) header.appendChild(makeText(meta, 12, false, C.textLo));
  header.appendChild(makeText("Developer Handoff", 12, false, C.textLo));
  root.appendChild(header);

  // Divider
  const divider = figma.createRectangle();
  divider.name = "Divider";
  divider.resize(1, 1);
  divider.fills = [{ type: "SOLID", color: C.border }];
  divider.layoutAlign = "STRETCH";
  root.appendChild(divider);

  const addSection = (label: string, items: string[], color: RGB) => {
    const filtered = items.filter(i => i.trim() !== "");
    if (filtered.length === 0) return;

    const section = figma.createFrame();
    section.name = label;
    section.layoutMode = "VERTICAL";
    section.primaryAxisSizingMode = "AUTO";
    section.counterAxisSizingMode = "AUTO";
    section.fills = [{ type: "SOLID", color: C.panel }];
    section.cornerRadius = 0;
    section.itemSpacing = 0;
    section.layoutAlign = "STRETCH";
    // clipsContent removed — it can prevent AUTO height from expanding

    const sectionHeader = figma.createFrame();
    sectionHeader.name = "Label";
    sectionHeader.layoutMode = "VERTICAL";
    sectionHeader.primaryAxisSizingMode = "AUTO";
    sectionHeader.counterAxisSizingMode = "AUTO";
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
      row.counterAxisSizingMode = "AUTO";   // height hugs tallest child
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
      itemText.fills = [{ type: "SOLID", color: C.textHi }];
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

  // Use absoluteBoundingBox so coords are always in canvas space,
  // even when the frame lives inside a Section (where x/y are section-relative).
  if (sourceNode) {
    const abs = sourceNode.absoluteBoundingBox;
    root.x = abs ? abs.x : sourceNode.x;
    root.y = abs ? abs.y + abs.height + 80 : sourceNode.y + sourceNode.height + 80;
  }

  figma.currentPage.appendChild(root);

  // Native Figma connector — references nodes by ID so it works whether the
  // source frame is on the canvas root or nested inside a Section.
  if (sourceNode) {
    try {
      const connector = figma.createConnector();
      figma.currentPage.appendChild(connector);
      connector.connectorStart = { endpointNodeId: sourceNode.id, magnet: "BOTTOM" };
      connector.connectorEnd   = { endpointNodeId: root.id,       magnet: "TOP"    };
      connector.strokeWeight = 2;
      connector.strokes = [{ type: "SOLID", color: { r: 0.27, g: 0.44, b: 0.98 } }];
      connector.connectorStartStrokeCap = "NONE";
      connector.connectorEndStrokeCap   = "ARROW_EQUILATERAL";
    } catch (e) {
      console.error("Connector error:", e);
    }
  }

  figma.viewport.scrollAndZoomIntoView(sourceNode ? [sourceNode, root] : [root]);
  figma.notify("Handoff created ✅");
  figma.closePlugin();
  } catch (e) {
    console.error("Handoff error:", e);
    figma.ui.postMessage({ type: "create-error", message: String(e) });
  }
};
