/** 简历预览：负责装配版面、工具栏与 iframe 交互，不在入口文件里堆叠测量细节。 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ReactNode } from "react";
import { measureResumeLayout, type LayoutMeasure } from "../utils/resumeLayoutMeasure";
import { calculatePreviewGeometry } from "./resume-preview/geometry";
import {
  A4_HEIGHT_PX,
  A4_WIDTH_PX,
  LIVE_PROBE_STYLE_ID,
  MAX_ZOOM,
  MIN_PREVIEW_HEIGHT,
  PREVIEW_BOTTOM_RESERVE,
  PREVIEW_HEIGHT_RATIO,
  PROBE_STYLE_ID,
  type AvailableSpace,
  type InteractionMode,
  type PanStart,
  type ResumePreviewHandle,
} from "./resume-preview/config";
import ResumePreviewCanvas from "./resume-preview/ResumePreviewCanvas";
import ResumePreviewToolbar from "./resume-preview/ResumePreviewToolbar";
import { layoutFrame } from "./resume-preview/layout";
import { forwardWheelToParent, useFrameInteractions } from "./resume-preview/useFrameInteractions";

interface Props {
  html: string;
  warnings: string[];
  /** 预览页数：与渲染时的 page_limit 一致。溢出时视觉上会横向展开。 */
  pages?: number;
  /** 仅作为首次布局尚未测量时的占位高度。 */
  height?: number;
  /** 提供后显示“点击编辑”模式，并返回结构化简历字段路径。 */
  onEditTarget?: (path: string) => void;
  /**
   * 把路径翻译成人话栏目名（`experience.0.description.1` → 「实习/工作经历「某某公司」的第 2 条要点」）。
   *
   * 由调用方提供：标签要靠简历内容才起得准，而预览组件本身只拿到渲染好的 HTML。
   */
  describePath?: (path: string) => string;
  /**
   * 事实来源标注（RF-13）：路径带标注时返回角标内容（label 显示在角标上，
   * sourceFact / boundary 放进悬停 Popover）；null 表示这一栏没有标注。
   */
  describeAnnotation?: (path: string) => {
    label: string;
    sourceFact: string;
    boundary: string;
  } | null;
  /** 渲染完成后的版式状态。pages 始终是用户设置的页数上限。 */
  onLayoutStatus?: (status: { pages: number; scale: number; overflow: boolean }) => void;
  /** 实测高度，交给版面诊断使用。 */
  onMeasure?: (measure: LayoutMeasure) => void;
  /**
   * 工具栏里的额外控件（简历版式：模板/字号/页数/行距）。
   *
   * 2026-10-20 从"画布上方单独一行"移进抓手那一行：用户要在同一行里边看边调，
   * 两行控件把预览区又往下挤了一截。传入的是已构造好的节点，预览本身不关心内容。
   */
  toolbarExtra?: ReactNode;
}

const ResumePreview = forwardRef<ResumePreviewHandle, Props>(function ResumePreview(
  {
    html,
    warnings,
    pages = 1,
    height,
    onEditTarget,
    describePath,
    describeAnnotation,
    onLayoutStatus,
    onMeasure,
    toolbarExtra,
  },
  ref,
) {
  const pageCount = Math.max(1, Math.round(pages));
  const paperHeight = A4_HEIGHT_PX * pageCount;
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const panStartRef = useRef<PanStart | null>(null);
  const frameCleanupRef = useRef<(() => void) | null>(null);
  const [availableSpace, setAvailableSpace] = useState<AvailableSpace>({
    width: 0,
    height: height ?? paperHeight,
  });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("pan");
  // "鼠标当前指向哪一栏"**不走 React 状态**，直接更新工具栏里的提示 DOM。
  //
  // 原因：事件监听器挂在 iframe 的文档上，而回调（onEditTarget / describePath）是父组件
  // 的内联函数、随父组件重渲染每次都是新引用——交互绑定的 effect 会因此反复重跑，
  // 若 hover 状态也在 React 里，"hover 生效 → 父重渲染 → effect 重跑 → cleanup 清空状态"
  // 会形成振荡（实测 hover 一生效就被清掉）。直接改 DOM 让这条链路只依赖监听器本身，
  // 与任何组件实例的生命周期无关。
  const [measure, setMeasure] = useState<LayoutMeasure | null>(null);
  const [overflow, setOverflow] = useState(false);
  const [naturalWidth, setNaturalWidth] = useState(A4_WIDTH_PX);

  const updateAvailableSpace = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const viewportHeight =
      typeof window === "undefined" ? (height ?? paperHeight) : window.innerHeight;
    const budget = Math.round(viewportHeight * PREVIEW_HEIGHT_RATIO);
    const ceiling = Math.max(MIN_PREVIEW_HEIGHT, viewportHeight - PREVIEW_BOTTOM_RESERVE);
    setAvailableSpace({
      width: container.clientWidth,
      height: Math.min(ceiling, Math.max(MIN_PREVIEW_HEIGHT, budget)),
    });
  }, [height, paperHeight]);

  const fitFrameContent = useCallback(() => {
    const document = iframeRef.current?.contentDocument;
    if (!document?.body || !document.documentElement) return;
    const result = layoutFrame({ document, pageCount, paperHeight });
    if (!result) return;
    if (result.measure) {
      setMeasure(result.measure);
      onMeasure?.(result.measure);
    }
    setOverflow(result.overflow);
    setNaturalWidth(result.naturalWidth);
    onLayoutStatus?.({ pages: pageCount, scale: result.scale, overflow: result.overflow });
  }, [onLayoutStatus, onMeasure, pageCount, paperHeight]);

  // 更新工具栏上的"正指向"提示（直接改 DOM；path 为 null 时隐藏）。
  const hoverChipRef = useRef<HTMLSpanElement>(null);
  const applyHoverChip = useCallback(
    (path: string | null) => {
      const chip = hoverChipRef.current;
      if (!chip) return;
      if (!path) {
        chip.style.display = "none";
        return;
      }
      chip.dataset.path = path;
      const label = chip.querySelector(".resume-preview-hover-label");
      if (label) label.textContent = describePath ? describePath(path) : path;
      // 事实来源角标（RF-13）：带标注的路径点亮角标；详情写进 data-* 供 Popover 读。
      const badge = chip.querySelector<HTMLElement>(".resume-preview-hover-badge");
      const annotation = badge && describeAnnotation ? describeAnnotation(path) : null;
      if (badge) {
        if (annotation) {
          badge.textContent = annotation.label;
          badge.dataset.sourceFact = annotation.sourceFact ?? "";
          badge.dataset.boundary = annotation.boundary ?? "";
          badge.style.display = "inline-flex";
        } else {
          badge.textContent = "";
          badge.style.display = "none";
        }
      }
      // R14：chip 是 flex 容器（不是 inline-flex）——它内部要「label 可收缩、按钮不换行」，
      // inline-flex 的固有宽度会让长 label 把按钮挤出可视区。显隐判定本身不变。
      chip.style.display = "flex";
    },
    [describePath, describeAnnotation],
  );

  const handleWheel = useCallback((event: globalThis.WheelEvent) => {
    // 普通滚轮交给弹窗/页面的纵向滚动；只有 Ctrl/Cmd + 滚轮才缩放预览，避免用户
    // 把鼠标放在简历上时误触发缩放，也避免 iframe 的独立文档吞掉外层滚动。
    if (event.ctrlKey || event.metaKey) {
      if (event.deltaY === 0) return;
      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;
      setZoom((current) => Math.min(MAX_ZOOM, Math.max(0.5, current + direction * 0.1)));
      return;
    }
    if (forwardWheelToParent(containerRef.current, event)) event.preventDefault();
  }, []);

  const bindFrameInteractions = useFrameInteractions({
    containerRef,
    iframeRef,
    panStartRef,
    frameCleanupRef,
    interactionMode,
    onEditTarget,
    onHoverTarget: applyHoverChip,
    onZoomWheel: handleWheel,
    onPanningChange: setIsPanning,
  });

  useImperativeHandle(
    ref,
    () => ({
      measureWithProbe(css: string) {
        const document = iframeRef.current?.contentDocument;
        if (!document?.body) return null;
        const style = document.getElementById("resume-preview-style") as HTMLStyleElement | null;
        const previousLayoutCss = style?.textContent ?? null;
        if (style) style.textContent = "";
        document.getElementById(PROBE_STYLE_ID)?.remove();
        if (css) {
          const probe = document.createElement("style");
          probe.id = PROBE_STYLE_ID;
          probe.textContent = css;
          document.head.appendChild(probe);
        }
        try {
          void document.body.offsetHeight;
          return measureResumeLayout(document, pageCount);
        } finally {
          if (css) document.getElementById(PROBE_STYLE_ID)?.remove();
          if (style && previousLayoutCss !== null) style.textContent = previousLayoutCss;
        }
      },
      setLiveProbe(css: string) {
        const document = iframeRef.current?.contentDocument;
        const head = document?.head;
        if (!document || !head) return;
        const existing = document.getElementById(LIVE_PROBE_STYLE_ID) as HTMLStyleElement | null;
        if (!css) {
          existing?.remove();
          return;
        }
        const style = existing ?? document.createElement("style");
        style.id = LIVE_PROBE_STYLE_ID;
        style.textContent = css;
        if (!existing) head.appendChild(style);
      },
    }),
    [pageCount],
  );

  useEffect(() => {
    setZoom(1);
    updateAvailableSpace();
    const container = containerRef.current;
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateAvailableSpace);
    if (container) observer?.observe(container);
    window.addEventListener("resize", updateAvailableSpace);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateAvailableSpace);
    };
  }, [html, pageCount, updateAvailableSpace]);

  const handleFrameLoad = useCallback(() => {
    fitFrameContent();
    updateAvailableSpace();
    bindFrameInteractions();
    requestAnimationFrame(() => {
      fitFrameContent();
      bindFrameInteractions();
    });
  }, [bindFrameInteractions, fitFrameContent, updateAvailableSpace]);

  const geometry = calculatePreviewGeometry({
    availableSpace,
    paperHeight,
    pageCount,
    zoom,
    overflow,
    naturalWidth,
    measure,
  });
  // 纵向空间归外层弹窗/页面管理：放大后让外层变长，不再制造第二条内部纵向滚动条，
  // 因此预览内容不会因为 overflow-y:hidden 被裁掉。
  const viewportHeight = Math.max(geometry.viewportHeightForPage, geometry.scaledHeight);

  const adjustZoom = (delta: number) => {
    setZoom((current) => Math.min(MAX_ZOOM, Math.max(0.5, current + delta)));
  };

  return (
    <div>
      <ResumePreviewToolbar
        extra={toolbarExtra}
        canEdit={Boolean(onEditTarget)}
        interactionMode={interactionMode}
        hoverChipRef={hoverChipRef}
        onRewriteHoverTarget={(path) => onEditTarget?.(path)}
        scale={geometry.scale}
        onInteractionModeChange={setInteractionMode}
        onAdjustZoom={adjustZoom}
        onResetZoom={() => setZoom(1)}
      />
      <ResumePreviewCanvas
        warnings={warnings}
        overflow={overflow}
        pagesNeeded={geometry.pagesNeeded}
        pageCount={pageCount}
        overflowAmountText={geometry.overflowAmountText}
        interactionMode={interactionMode}
        isPanning={isPanning}
        viewportHeight={viewportHeight}
        scaledWidth={geometry.scaledWidth}
        scaledHeight={geometry.scaledHeight}
        contentTotalWidth={geometry.contentTotalWidth}
        contentTotalHeight={geometry.contentTotalHeight}
        scale={geometry.scale}
        separatorCount={geometry.separatorCount}
        totalVisualPages={geometry.totalVisualPages}
        html={html}
        containerRef={containerRef}
        iframeRef={iframeRef}
        onIframeLoad={handleFrameLoad}
      />
    </div>
  );
});

export type { ResumePreviewHandle } from "./resume-preview/config";
export default ResumePreview;
