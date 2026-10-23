// SPDX-License-Identifier: Apache-2.0
/** 简历预览：负责装配版面、工具栏与 iframe 交互，不在入口文件里堆叠测量细节。 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ReactNode, SyntheticEvent } from "react";
import { measureResumeLayout, type LayoutMeasure } from "../utils/resumeLayoutMeasure";
import { calculatePreviewGeometry } from "./resume-preview/geometry";
import {
  A4_HEIGHT_PX,
  A4_WIDTH_PX,
  LIVE_PROBE_STYLE_ID,
  MAX_ZOOM,
  MAX_FIT_SCALE_DEFAULT,
  MIN_PREVIEW_HEIGHT,
  PREVIEW_BOTTOM_RESERVE,
  PREVIEW_HEIGHT_RATIO,
  PROBE_STYLE_ID,
  type AvailableSpace,
  type PanStart,
  type PreviewMode,
  type ResumePreviewHandle,
} from "./resume-preview/config";
import ExactPreviewPanel from "./resume-preview/ExactPreviewPanel";
import ResumePreviewCanvas from "./resume-preview/ResumePreviewCanvas";
import PreviewZoomBar from "./resume-preview/PreviewZoomBar";
import ResumePreviewToolbar from "./resume-preview/ResumePreviewToolbar";
import BoldContextMenu, { type RichTextEditAdapter } from "./resume-preview/BoldContextMenu";
import { useClickToEditPreview } from "./resume-preview/useClickToEditPreview";
import { layoutFrame } from "./resume-preview/layout";
import { forwardWheelToParent, useFrameInteractions } from "./resume-preview/useFrameInteractions";

/** 精确预览需要的那组上下文（与 `ResumeDetailPreview` 手里的草稿值一致）。 */
export interface ExactPreviewOptions {
  resumeId: number;
  /** 草稿的模板名（内置或自制）。 */
  template: string;
  /** 草稿的版式名。 */
  formatName: string;
  fontScale: string;
  /**
   * 纸面文案的语言（`zh-CN` / `en-US`）。
   *
   * 必须一路传到服务端：精确预览显示的就是导出产物本身，语言传不进去就会
   * "草稿里选了英文、精确预览还是中文"。
   */
  language: string;
  formatConfig: Record<string, unknown>;
  /** 正文 + 模板的身份：内容改了也要重排一次 PDF（见 `ExactPreviewPanel`）。 */
  contentSignature: string;
}

interface Props {
  html: string;
  warnings: string[];
  /** 预览页数：与渲染时的 page_limit 一致。溢出时视觉上会多排一页。 */
  pages?: number;
  /** 仅作为首次布局尚未测量时的占位高度。 */
  height?: number;
  /**
   * 宿主量出来的**真实可用高度**（px），给了就不再用窗口比例估算。
   *
   * 存在的原因是"一页纸完整可见"：主预览嵌在列表页里，可用高度与窗口高度差不多成正比，
   * `window.innerHeight × PREVIEW_HEIGHT_RATIO` 够用；而简历制作台的右栏高度由三栏布局
   * 决定，与窗口高度没有固定比例，猜出来的值会让纸张明显偏小、四周一片留白。
   * 语义是"**整块预览**可用的高度"（含工具条与缩放条）——那几条由本组件扣掉
   * （`chromeHeight` 实测），纸面只拿剩下的部分。不传时行为**一字不变**。
   */
  availableHeight?: number;
  /** 渲染完成后的版式状态。pages 始终是用户设置的页数上限。 */
  onLayoutStatus?: (status: { pages: number; overflow: boolean }) => void;
  /** 实测高度，交给版面诊断使用。 */
  onMeasure?: (measure: LayoutMeasure) => void;
  /**
   * 工具栏**第一行右侧**的控件：结构类版式（模板 / 版式 / 板块顺序 / 最大篇幅）。
   *
   * P2 起工具栏是两行、且由两个**具名插槽**分别喂数据（D4）：结构类与度量类性质不同，
   * 同一行里会互相抢位置。传入的是已构造好的节点，预览本身不关心内容。
   */
  templateControls?: ReactNode;
  /**
   * 工具栏**第二行左侧**的控件：度量类版式（字号 / 行距 / 页边距）。
   *
   * 缩放条不在工具栏里：它由预览自己渲染在纸面下方（缩放是"看"的动作，不是"改"的动作）。
   */
  measureControls?: ReactNode;
  /**
   * 精确预览（方案 A）：给出简历 id 与**当前草稿版式**，就用服务端排出的真实 PDF 渲染。
   *
   * 草稿模式用 CSS 多列模拟分页，断点由浏览器多列算法决定；导出 PDF 由 `pdf_exporter`
   * 另排一遍——两套引擎不可能"严格相同"。精确模式显示的就是导出产物本身。
   * 缺省不提供：拿不到稳定记录 id 的场景（生成流程的临时预览）不该摆一个必然失败的开关。
   */
  exactPreview?: ExactPreviewOptions;
  /**
   * 预览口径。**受控**：主预览与「简历制作台」共享同一份状态，在一处切换另一处跟着走
   * （2026-10-21 用户要求："当前在草稿，制作台就是草稿；当前在精确，制作台就是精确"）；
   * 不传时组件内部自管（生成流程那种只读场景）。
   */
  previewMode?: PreviewMode;
  onPreviewModeChange?: (mode: PreviewMode) => void;
  /**
   * 「草稿模式编辑」的落点回调：点纸面上带 `data-resume-path` 的文字时，把那条路径交出去。
   * **不传即整条链路不激活**（工具栏不渲染复选框、iframe 里也不挂监听），导出/分享那种
   * 只读宿主因此一行都不用改。
   */
  onPickField?: (path: string) => void;
  richEdit?: RichTextEditAdapter; // 右键加粗的最小契约；不传 = 整条链路不渲染
}

/**
 * 预览只"看"不改（2026-10-21）。
 *
 * 它曾经有一套"编辑"模式：iframe 接上指针事件、给每个 `[data-resume-path]` 挂
 * `role=button`，点一下纸面字段就打开对应栏的编辑器。这条路径被去掉了——修改入口
 * 已经统一到「选中文字 → 右键 → AI 润色」与「手动调整」，预览里再留一套命中区等于
 * 同一件事两个入口、两套命中规则；而且它要求 iframe 接管指针事件，与"按住拖动平移"
 * 互斥（iframe 文档里的事件不冒泡到父文档，容器就收不到 pointerdown）。
 *
 * 2026-11 补回**只挂 `click`** 的那一半（`resume-preview/useClickToEditPreview`）：不接管
 * 指针事件，拖动平移与 Ctrl+滚轮缩放照旧；命中区是后端模板已有的 `data-resume-path`。
 */
/**
 * 读 `--rf-a4-max-fit`：大屏（≥1920）允许把纸放大到 1.35，其余档位保持"永不放大"。
 *
 * 放在模块级是为了给 `useState` 当惰性初始化——首帧就要有正确的上限，否则大屏会先画
 * 一张小纸、下一帧再跳大。jsdom 读不到自定义属性（返回空串）时兜底 1。
 */
function readMaxFitScale(): number {
  if (typeof document === "undefined") return MAX_FIT_SCALE_DEFAULT;
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue("--rf-a4-max-fit");
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : MAX_FIT_SCALE_DEFAULT;
}

const ResumePreview = forwardRef<ResumePreviewHandle, Props>(function ResumePreview(
  {
    html,
    warnings,
    pages = 1,
    height,
    availableHeight,
    onLayoutStatus,
    onMeasure,
    templateControls,
    measureControls,
    exactPreview,
    previewMode,
    onPreviewModeChange,
    onPickField,
    richEdit,
  },
  ref,
) {
  const pageCount = Math.max(1, Math.round(pages));
  const paperHeight = A4_HEIGHT_PX * pageCount;
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const panStartRef = useRef<PanStart | null>(null);
  // 只在给了 `availableHeight` 时才有意义：根节点与"草稿画布宿主"盒子的高度差就是预览
  // 自己的工具条 + 缩放条 + 间距（见下面测 `chromeHeight` 的 effect）。
  const rootRef = useRef<HTMLDivElement>(null);
  const draftHostRef = useRef<HTMLDivElement>(null);
  const [chromeHeight, setChromeHeight] = useState(0);
  const [availableSpace, setAvailableSpace] = useState<AvailableSpace>({
    width: 0,
    height: height ?? paperHeight,
  });
  const [zoom, setZoom] = useState(1);
  // 大屏放大上限读 CSS 变量 `--rf-a4-max-fit`（A 档 1.35）。
  // 用惰性初始化而不是 effect：首帧就要有正确的上限，否则大屏会先画一张小纸再跳大。
  // jsdom 里读不到变量（返回空串）→ 兜底 1，与既有断言完全一致。
  const [maxFitScale, setMaxFitScale] = useState(readMaxFitScale);
  useEffect(() => {
    // 跨 1920 断点（外接屏 / 改窗口）后上限要跟着变；读的是同一个 CSS 变量，没有第二份数值。
    const sync = () => setMaxFitScale(readMaxFitScale());
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);
  const [isPanning, setIsPanning] = useState(false);
  const [measure, setMeasure] = useState<LayoutMeasure | null>(null);
  const [overflow, setOverflow] = useState(false);
  const [naturalWidth, setNaturalWidth] = useState(A4_WIDTH_PX);
  // 预览口径：给了 `previewMode` 就是受控（主预览与制作台共享一份状态），否则自管。
  const [innerMode, setInnerMode] = useState<PreviewMode>("draft");
  const activeMode = previewMode ?? innerMode;
  const canExactPreview = Boolean(exactPreview?.resumeId);

  const changeMode = useCallback(
    (mode: PreviewMode) => {
      setInnerMode(mode);
      onPreviewModeChange?.(mode);
    },
    [onPreviewModeChange],
  );

  const updateAvailableSpace = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    // 宿主给了真实高度就以它为准（扣掉本组件自己的工具条/缩放条），不再猜窗口比例。
    if (availableHeight !== undefined) {
      setAvailableSpace({
        width: container.clientWidth,
        height: Math.max(1, Math.round(availableHeight - chromeHeight)),
      });
      return;
    }
    const viewportHeight =
      typeof window === "undefined" ? (height ?? paperHeight) : window.innerHeight;
    const budget = Math.round(viewportHeight * PREVIEW_HEIGHT_RATIO);
    const ceiling = Math.max(MIN_PREVIEW_HEIGHT, viewportHeight - PREVIEW_BOTTOM_RESERVE);
    setAvailableSpace({
      width: container.clientWidth,
      height: Math.min(ceiling, Math.max(MIN_PREVIEW_HEIGHT, budget)),
    });
  }, [availableHeight, chromeHeight, height, paperHeight]);

  /**
   * 对**一个** iframe 应用分页样式，并把它滚到第 `index` 列。
   *
   * 每个 iframe 都是同一份 HTML 的独立文档：`layoutFrame` 会把 body 撑成 `页数 × 794`
   * 宽、切成对应数量的列，然后这个 iframe 只开一个 A4 的窗口、横向滚到第 index 列。
   * 所以"第 i 页"= 同一份排版的第 i 列，断点口径与横向并排时**完全一致**。
   *
   * 每页都跑一次测量是刻意的：只有第 1 页上报状态（`index === 0`），但每页都得拿到
   * 同一份列宽 / 列间距——否则某一页的列宽算错，那一页就会显示成"上一列的尾巴"。
   */
  const applyLayoutToFrame = useCallback(
    (frame: HTMLIFrameElement, index: number) => {
      const document = frame.contentDocument;
      if (!document?.body || !document.documentElement) return;
      const result = layoutFrame({ document, pageCount, paperHeight });
      if (!result) return;
      if (index === 0) {
        if (result.measure) {
          setMeasure(result.measure);
          onMeasure?.(result.measure);
        }
        setOverflow(result.overflow);
        setNaturalWidth(result.naturalWidth);
        onLayoutStatus?.({ pages: pageCount, overflow: result.overflow });
      }
      // `overflow: hidden` 的文档仍然可以编程滚动（只是不给用户拖滚动条）。
      if (index > 0) {
        const target = index * A4_WIDTH_PX;
        document.documentElement.scrollLeft = target;
        document.body.scrollLeft = target;
        document.defaultView?.scrollTo(target, 0);
      }
    },
    [onLayoutStatus, onMeasure, pageCount, paperHeight],
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

  const { bindFrame } = useFrameInteractions({
    containerRef,
    panStartRef,
    onZoomWheel: handleWheel,
    onPanningChange: setIsPanning,
    // 草稿画布在「草稿 / 精确」之间切换时会卸载再挂载，视口元素随之换新；
    // 不把这件事告诉 hook，滚轮/拖动就会绑在已卸载的那个 div 上（缩放失效）。
    viewportKey: activeMode,
  });

  /*
   * 「草稿模式编辑」：状态机与监听注册全在 `resume-preview/useClickToEditPreview`。
   * `bindDocument` 是稳定引用，所以 `handleFrameLoad` 的依赖里只写它一个。
   */
  const draftMode = activeMode === "draft";
  const {
    checked,
    setChecked,
    available,
    active,
    bindDocument: bindClickToEdit,
    boldMenu,
  } = useClickToEditPreview({ containerRef, draftMode, onPickField, richEdit });

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

  const handleFrameLoad = useCallback(
    (event: SyntheticEvent<HTMLIFrameElement>, index: number) => {
      const frame = event.currentTarget;
      bindFrame(frame);
      applyLayoutToFrame(frame, index);
      // 点击定位：每个 page 的文档都要挂一次（多页时 index 各自独立，重复调用由它自己判重）。
      bindClickToEdit(frame.contentDocument);
      // 立刻量一次"结构已就位"，下一帧再量一次"字体把行高撑开之后"。
      requestAnimationFrame(() => {
        bindFrame(frame);
        applyLayoutToFrame(frame, index);
      });
    },
    [applyLayoutToFrame, bindClickToEdit, bindFrame],
  );

  const geometry = calculatePreviewGeometry({
    availableSpace,
    paperHeight,
    pageCount,
    zoom,
    overflow,
    naturalWidth,
    maxFitScale,
    // 竖排后画布自己不再画分页条（页与页之间是真实的空白），这个入参只为兼容旧签名。
    pageGap: 0,
    measure,
  });
  // 纵向空间归外层弹窗/页面管理：多页竖排后整块会比一屏高，靠外层滚动看下一页，
  // 不再制造第二条内部纵向滚动条。
  const viewportHeight = Math.max(geometry.viewportHeightForPage, geometry.scaledHeight);

  const adjustZoom = (delta: number) => {
    setZoom((current) => Math.min(MAX_ZOOM, Math.max(0.5, current + delta)));
  };

  /*
   * 精确模式下草稿画布**不卸载**，只是被裁成 0 高。
   *
   * 版面诊断的实测高度、溢出状态与「自动一页」的逐档试版式（`measureWithProbe`）全都来自
   * 它里面的那个 iframe——卸载它等于把唯一的测量来源掐掉，表现就是"在精确模式里改参数，
   * 诊断面板整块不动"（2026-10-21 用户实测）。
   * 为什么是 `height: 0` + `overflow: hidden` 而不是 `hidden` 属性：后者是 `display: none`，
   * 里面的 iframe 根本不排版，量出来全是 0；裁成 0 高则照常排版、照常可测，只是看不见。
   * 没人听测量结果时（生成流程那种只读场景）就不挂——白挂一个看不见的 iframe 是纯开销。
   */
  const measuringOnly = canExactPreview && activeMode === "exact";
  const mountDraftCanvas = !measuringOnly || Boolean(onMeasure || onLayoutStatus);

  /*
   * `availableHeight` 是"整块预览"的预算，而纸张只能拿减去工具条与缩放条之后的那部分。
   *
   * 工具条与缩放条的高度不该写成常量：缩放条是 antd 按钮（尺寸随主题变），工具条在
   * "有没有版式控件"两种宿主下高度完全不同。这里用**根节点减草稿画布宿主**的差值实测——
   * 两者之间只夹着工具条、可能存在的警告条外壳与缩放条，而这个差值不受纸张高度影响
   * （纸张高度是被算出来的，工具条是它自己的内容），所以一次测量就稳定，不会自激。
   *
   * 只在给了 `availableHeight` 时才量：主预览走窗口比例口径，一行都没变。
   */
  useEffect(() => {
    if (availableHeight === undefined) return;
    const root = rootRef.current;
    const host = draftHostRef.current;
    if (!root || !host) return;
    const measured = Math.max(
      0,
      Math.round(root.getBoundingClientRect().height - host.getBoundingClientRect().height),
    );
    setChromeHeight((previous) => (previous === measured ? previous : measured));
    // 只在"宿主刚给出预算"那一轮量一次：工具条的构成不会随纸张尺寸变化。
  }, [availableHeight]);

  return (
    <div ref={rootRef}>
      <ResumePreviewToolbar
        templateControls={templateControls}
        measureControls={measureControls}
        canExactPreview={canExactPreview}
        previewMode={activeMode}
        onPreviewModeChange={changeMode}
        clickToEdit={checked}
        onClickToEditChange={setChecked}
        clickToEditAvailable={available}
      />
      {/*
       * 精确面板**常驻**：草稿模式下只是把它藏起来（`hidden`），不卸载。
       *
       * 卸载会连同内嵌 PDF 查看器一起销毁，切回来等于重新开一个查看器——用户看到的
       * 是一次几百毫秒的白屏，此前还会附赠一次完整的服务端重排（2026-10-21 用户实测：
       * 「什么都没改，跳回精确却还要重排一次」）。`active=false` 时面板不发请求，
       * 所以"常驻"的代价只是一个空 div。
       */}
      {canExactPreview ? (
        <div hidden={activeMode !== "exact"}>
          <ExactPreviewPanel
            active={activeMode === "exact"}
            resumeId={exactPreview!.resumeId}
            template={exactPreview!.template}
            formatName={exactPreview!.formatName}
            pageLimit={pageCount}
            fontScale={exactPreview!.fontScale}
            language={exactPreview!.language}
            formatConfig={exactPreview!.formatConfig}
            contentSignature={exactPreview!.contentSignature}
            height={Math.max(MIN_PREVIEW_HEIGHT, viewportHeight)}
          />
        </div>
      ) : null}
      {mountDraftCanvas ? (
        <div
          ref={draftHostRef}
          // 精确模式下它只是"测量用的尸体"：看不见、不占位，但仍在排版。
          style={measuringOnly ? { height: 0, overflow: "hidden" } : undefined}
          aria-hidden={measuringOnly || undefined}
        >
          <ResumePreviewCanvas
            warnings={warnings}
            overflow={overflow}
            overflowClipped={geometry.overflowClipped}
            pagesNeeded={geometry.pagesNeeded}
            pageCount={pageCount}
            overflowAmountText={geometry.overflowAmountText}
            isPanning={isPanning}
            viewportHeight={viewportHeight}
            scaledWidth={geometry.scaledWidth}
            scaledHeight={geometry.scaledHeight}
            scale={geometry.scale}
            totalVisualPages={geometry.totalVisualPages}
            html={html}
            containerRef={containerRef}
            iframeRef={iframeRef}
            onIframeLoad={handleFrameLoad}
            clickToEdit={active}
          />
        </div>
      ) : null}
      {/* 缩放条只服务**草稿**预览：精确模式里缩放是浏览器 PDF 查看器自己的事。 */}
      {canExactPreview && activeMode === "exact" ? null : (
        <PreviewZoomBar
          scale={geometry.scale}
          clampedToMin={geometry.clampedToMin}
          onZoomOut={() => adjustZoom(-0.1)}
          onZoomIn={() => adjustZoom(0.1)}
          onReset={() => setZoom(1)}
        />
      )}
      {boldMenu ? <BoldContextMenu {...boldMenu} /> : null}
    </div>
  );
});

export type { ResumePreviewHandle } from "./resume-preview/config";
export default ResumePreview;
