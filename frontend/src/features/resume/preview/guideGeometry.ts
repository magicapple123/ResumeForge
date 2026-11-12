// SPDX-License-Identifier: Apache-2.0
/**
 * 版面辅助线的几何与 DOM 层（D05）。
 *
 * ## 两条不能破的约束
 *
 * 1. **辅助层只在编辑器 iframe 的**临时文档**里**：纸面 HTML 是后端产物，前端一个字节都
 *    不改。所以这里拿到的是 `iframe.contentDocument`，注入的节点只活在浏览器里，
 *    导出（HTML/PDF/Word）走服务端同一份产物，天然没有它们。
 * 2. **不改变纸面布局**：覆盖层用 `position: fixed` + `pointer-events: none`，
 *    不参与文档流；关掉时整层移除（不是 display:none 留在 DOM）。
 *
 * ## 几何来源
 *
 * 页边距与基线都从**实际渲染后的文档**量：body 的 computed padding、computed line-height。
 * 不读 `format_config` 再猜模板默认值——模板 8 套、默认值各不同，前端口径必有一份会漂。
 */
import type { GuideFlags } from "./types";

export const GUIDE_LAYER_ID = "resume-proview-guide-layer";

export interface GuideInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ParagraphBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GuideGeometry {
  pageWidth: number;
  pageHeight: number;
  insets: GuideInsets;
  /** 列边界（内容区中线）的 x 坐标；只有单列内容区一条。 */
  columnX: number;
  /** 基线 y 坐标（内容区从上往下按行高排）。 */
  baselines: number[];
  /** 段落边界盒子（来自实际 DOM 元素）。 */
  paragraphs: ParagraphBox[];
}

export interface GuideMeasureInput {
  pageWidth: number;
  pageHeight: number;
  padding: GuideInsets;
  lineHeight: number;
  paragraphs: ParagraphBox[];
}

/** 基线最多画这么多条：超高内容（长 CV）下不生成上万个节点。 */
const MAX_BASELINES = 120;
/** 段落边界最多保留这么多盒：覆盖层是提示，不是全文描边。 */
const MAX_PARAGRAPHS = 400;

/** 从已量到的数字算一份完整几何（纯函数）。 */
export function computeGuideGeometry(input: GuideMeasureInput): GuideGeometry {
  const pageWidth = Math.max(1, input.pageWidth);
  const pageHeight = Math.max(1, input.pageHeight);
  const lineHeight =
    Number.isFinite(input.lineHeight) && input.lineHeight > 0 ? input.lineHeight : 0;
  const contentTop = input.padding.top;
  const contentBottom = Math.max(contentTop, pageHeight - input.padding.bottom);
  const contentLeft = input.padding.left;
  const contentRight = Math.max(contentLeft, pageWidth - input.padding.right);
  const baselines: number[] = [];
  if (lineHeight > 0) {
    for (
      let y = contentTop + lineHeight;
      y <= contentBottom && baselines.length < MAX_BASELINES;
      y += lineHeight
    ) {
      baselines.push(Math.round(y * 100) / 100);
    }
  }
  return {
    pageWidth,
    pageHeight,
    insets: input.padding,
    columnX: Math.round(((contentLeft + contentRight) / 2) * 100) / 100,
    baselines,
    paragraphs: input.paragraphs.slice(0, MAX_PARAGRAPHS),
  };
}

/**
 * 覆盖层的视觉取值（**只在这里定义一次**，再以 CSS 变量挂到覆盖层根节点上）。
 *
 * 为什么不用 `--rf-*`：纸面是 iframe 里的**独立文档**，父页面的主题变量不会级联进去；
 * 而纸面本身恒为白底（简历要打印），所以辅助线用固定的半透明色是语义正确的。
 * 变量化的目的是"颜色只有一处定义、节点只引用变量"，与主题无关的这一条在注释里说清。
 */
const GUIDE_COLORS = {
  margins: "rgba(30, 58, 138, 0.55)",
  columns: "rgba(124, 58, 237, 0.55)",
  baselines: "rgba(30, 58, 138, 0.16)",
  paragraphs: "rgba(217, 119, 6, 0.6)",
} as const;

const GUIDE_VARS = {
  margins: "--proview-guide-margins",
  columns: "--proview-guide-columns",
  baselines: "--proview-guide-baselines",
  paragraphs: "--proview-guide-paragraphs",
} as const;

function line(
  doc: Document,
  guide: string,
  style: { left: number; top: number; width: number; height: number },
  color: string,
  dashed = false,
): HTMLElement {
  const node = doc.createElement("div");
  node.dataset.proviewGuide = guide;
  node.style.position = "absolute";
  node.style.left = `${style.left}px`;
  node.style.top = `${style.top}px`;
  node.style.width = `${style.width}px`;
  node.style.height = `${style.height}px`;
  node.style.background = dashed ? "transparent" : color;
  node.style.borderLeft = dashed ? `1px dashed ${color}` : "none";
  node.style.pointerEvents = "none";
  return node;
}

/**
 * 把覆盖层画进一个纸面文档（幂等：先删旧层再建新层）。
 *
 * 只创建**已开启类别**的节点：四类全关时调用方应直接 `clearGuideLayer`，
 * 这里也兜底返回 `null`（不建空层）。
 */
export function renderGuideLayer(
  doc: Document,
  geometry: GuideGeometry,
  flags: GuideFlags,
): HTMLElement | null {
  clearGuideLayer(doc);
  const { pageWidth, pageHeight, insets } = geometry;
  const contentWidth = Math.max(0, pageWidth - insets.left - insets.right);
  const contentHeight = Math.max(0, pageHeight - insets.top - insets.bottom);
  const anyFlag = flags.margins || flags.columns || flags.baselines || flags.paragraphs;
  if (!anyFlag) return null;

  const layer = doc.createElement("div");
  layer.id = GUIDE_LAYER_ID;
  layer.dataset.proviewOverlay = "guides";
  layer.setAttribute("aria-hidden", "true");
  layer.style.position = "fixed";
  layer.style.inset = "0";
  layer.style.overflow = "hidden";
  layer.style.pointerEvents = "none";
  layer.style.zIndex = "2147483000";
  layer.style.contain = "strict";
  // 颜色只在上面定义一次；节点只引用变量。
  layer.style.setProperty(GUIDE_VARS.margins, GUIDE_COLORS.margins);
  layer.style.setProperty(GUIDE_VARS.columns, GUIDE_COLORS.columns);
  layer.style.setProperty(GUIDE_VARS.baselines, GUIDE_COLORS.baselines);
  layer.style.setProperty(GUIDE_VARS.paragraphs, GUIDE_COLORS.paragraphs);

  if (flags.margins) {
    // 四条页边距线：内容区的四条边（内缩 insets）。
    layer.appendChild(
      line(
        doc,
        "margin-top",
        { left: insets.left, top: insets.top, width: contentWidth, height: 1 },
        "var(--proview-guide-margins)",
      ),
    );
    layer.appendChild(
      line(
        doc,
        "margin-bottom",
        { left: insets.left, top: insets.top + contentHeight, width: contentWidth, height: 1 },
        "var(--proview-guide-margins)",
      ),
    );
    layer.appendChild(
      line(
        doc,
        "margin-left",
        { left: insets.left, top: insets.top, width: 1, height: contentHeight },
        "var(--proview-guide-margins)",
      ),
    );
    layer.appendChild(
      line(
        doc,
        "margin-right",
        { left: insets.left + contentWidth, top: insets.top, width: 1, height: contentHeight },
        "var(--proview-guide-margins)",
      ),
    );
  }
  if (flags.columns) {
    layer.appendChild(
      line(
        doc,
        "column",
        { left: geometry.columnX, top: insets.top, width: 0, height: contentHeight },
        "var(--proview-guide-columns)",
        true,
      ),
    );
  }
  if (flags.baselines) {
    for (const y of geometry.baselines) {
      layer.appendChild(
        line(
          doc,
          "baseline",
          { left: insets.left, top: y, width: contentWidth, height: 1 },
          "var(--proview-guide-baselines)",
        ),
      );
    }
  }
  if (flags.paragraphs) {
    for (const box of geometry.paragraphs) {
      const node = line(doc, "paragraph", box, "var(--proview-guide-paragraphs)", true);
      node.style.background = "transparent";
      node.style.border = "1px dashed var(--proview-guide-paragraphs)";
      layer.appendChild(node);
    }
  }
  (doc.body ?? doc.documentElement).appendChild(layer);
  return layer;
}

/** 移除覆盖层；文档已卸载 / 节点不在时安静返回。 */
export function clearGuideLayer(doc: Document | null): void {
  doc?.getElementById(GUIDE_LAYER_ID)?.remove();
}

/**
 * 从**已渲染的文档**量辅助线需要的数字。
 *
 * 段落盒子取"语义块"的 rect：模板已有的 `data-resume-path`（字段行）与常见块类
 * （`.entry` / `.section-title` / `.item`）；按 rect 去重，避免同一块被多个选择器重复画。
 */
export function measureGuideGeometry(
  doc: Document,
  pageWidth: number,
  pageHeight: number,
): GuideGeometry {
  const view = doc.defaultView;
  const body = doc.body;
  if (!view || !body) {
    return computeGuideGeometry({
      pageWidth,
      pageHeight,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      lineHeight: 0,
      paragraphs: [],
    });
  }
  const bodyStyle = view.getComputedStyle(body);
  const px = (value: string, fallback = 0): number => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const insets: GuideInsets = {
    top: px(bodyStyle.paddingTop),
    right: px(bodyStyle.paddingRight),
    bottom: px(bodyStyle.paddingBottom),
    left: px(bodyStyle.paddingLeft),
  };
  const fontSize = px(bodyStyle.fontSize, 16);
  const rawLineHeight = bodyStyle.lineHeight;
  const lineHeight =
    rawLineHeight === "normal" ? fontSize * 1.5 : px(rawLineHeight, fontSize * 1.5);

  const seen = new Set<string>();
  const paragraphs: ParagraphBox[] = [];
  const nodes = body.querySelectorAll<HTMLElement>(
    "[data-resume-path], .entry, .section-title, .item, li",
  );
  nodes.forEach((node) => {
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    if (rect.bottom < 0 || rect.top > pageHeight) return;
    const key = `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
    if (seen.has(key)) return;
    seen.add(key);
    paragraphs.push({
      left: Math.round(rect.left * 100) / 100,
      top: Math.round(rect.top * 100) / 100,
      width: Math.round(rect.width * 100) / 100,
      height: Math.round(rect.height * 100) / 100,
    });
  });
  return computeGuideGeometry({ pageWidth, pageHeight, padding: insets, lineHeight, paragraphs });
}
