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
  MIN_PREVIEW_HEIGHT,
  PREVIEW_BOTTOM_RESERVE,
  PREVIEW_HEIGHT_RATIO,
  PROBE_STYLE_ID,
  type AvailableSpace,
  type PanStart,
  type PreviewMode,
  type ResumePreviewHandle,
} from "./resume-preview/config";
import { useProviewConfig } from "../features/resume-proview/ProviewContext";
import { useMaxFitScale, usePreviewZoom } from "../features/resume-proview/usePreviewZoom";
import ProviewLayer from "./resume/proview/ProviewLayer";
import ExactPreviewPanel from "./resume-preview/ExactPreviewPanel";
import type { ExactPreviewOptions } from "./resume-preview/exactPreviewOptions";
import ResumePreviewCanvas from "./resume-preview/ResumePreviewCanvas";
import PreviewAlerts from "./resume-preview/PreviewAlerts";
import PreviewZoomBar from "./resume-preview/PreviewZoomBar";
import ResumePreviewToolbar from "./resume-preview/ResumePreviewToolbar";
import BoldContextMenu, { type RichTextEditAdapter } from "./resume-preview/BoldContextMenu";
import { useClickToEditPreview } from "./resume-preview/useClickToEditPreview";
import { layoutFrame } from "./resume-preview/layout";
import { forwardWheelToParent, useFrameInteractions } from "./resume-preview/useFrameInteractions";
import { usePreviewBodyHeight } from "./resume-preview/usePreviewBodyHeight";

// `ExactPreviewOptions` 的定义在 `resume-preview/exactPreviewOptions.ts`，这里 re-export 保持调用点不变。

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
  /** 是否渲染「草稿模式编辑」开关（预览弹窗传 false，详细编辑去制作台）。 */
  showClickToEdit?: boolean;
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
  /** 缩放条提示语的覆盖（制作台把分页说明并进那一行）；不传时用默认文案。 */
  zoomHint?: string;
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
 * 预览只"看"不改（2026-10-21）：那套"iframe 接管指针事件、点纸面即开编辑器"的编辑模式
 * 已删除（与拖动平移互斥，且与「选中文字 → 右键 / 手动调整」两个入口重复）；2026-11 补回
 * **只挂 click** 的一半（`resume-preview/useClickToEditPreview`），命中区仍是后端的
 * `data-resume-path`。详见该模块头部。
 */
const ResumePreview = forwardRef<ResumePreviewHandle, Props>(function ResumePreview(
  {
    html,
    warnings,
    pages = 1,
    height,
    availableHeight,
    // 默认 true：制作台仍要这个开关；预览弹窗显式传 false。
    showClickToEdit = true,
    onLayoutStatus,
    onMeasure,
    templateControls,
    measureControls,
    zoomHint,
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const panStartRef = useRef<PanStart | null>(null);
  /**
   * 纸面滚动区的真实高度（0 = 还没量到）。只在宿主给了 `availableHeight`（制作台右栏）时量：
   * 主预览走窗口比例口径，一行都不变。算不出来的部分（工具条、提示条、缩放条）由这一层直接
   * 让位给它——**不再靠"根节点减草稿宿主"去推**，那个差值在纸比容器高时会塌成 0。
   */
  const bodyHeight = usePreviewBodyHeight(bodyRef, availableHeight !== undefined);
  const [availableSpace, setAvailableSpace] = useState<AvailableSpace>({
    width: 0,
    height: height ?? paperHeight,
  });
  // 缩放系数 + Ctrl 滚轮 + 大屏上限：W15 拆到 `usePreviewZoom`（行为逐字保留），
  // 这样专业视图的缩放档位有一个独立测试面，不必整棵预览一起挂。
  const { zoom, setZoom, adjustZoom, resetZoom, zoomByWheel } = usePreviewZoom();
  const maxFitScale = useMaxFitScale();
  /** iframe 每次加载/重排后自增：专业视图的覆盖层与页位置据此重新同步。 */
  const [frameEpoch, setFrameEpoch] = useState(0);
  /**
   * 精确模式的状态行（实际页数 / 在新标签打开）。由 `ExactPreviewPanel` 通过 `onStatus`
   * 交出来，和缩放条并成一行——两行各自居中会读成两块无关的东西（2026-10-29 用户要求）。
   */
  const [exactStatus, setExactStatus] = useState<ReactNode>(null);
  // 专业视图能力由画布宿主注入；主预览（列表页）没有 Provider → 整块不渲染。
  const proviewConfig = useProviewConfig();
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
    // 宿主给了真实高度就以它为准：优先用纸面那一层量到的高度（已扣掉工具条/提示条/缩放条），
    // 量不到（首帧、jsdom）时退回宿主给的总预算。两条都不猜窗口比例。
    if (availableHeight !== undefined) {
      setAvailableSpace({
        width: container.clientWidth,
        height: bodyHeight > 0 ? bodyHeight : Math.max(1, Math.round(availableHeight)),
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
  }, [availableHeight, bodyHeight, height, paperHeight]);

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

  const handleWheel = useCallback(
    (event: globalThis.WheelEvent) => {
      if (event.defaultPrevented) return; // 内层（草稿视口）已经处理过这一拍
      // Ctrl/Cmd：**只缩放、不滚动**（先 preventDefault 挡掉浏览器整页缩放；靠 zoomByWheel 的返回值会掉进"转交滚动"）。
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        zoomByWheel(event);
        return;
      }
      if (forwardWheelToParent(containerRef.current, event)) event.preventDefault();
    },
    [zoomByWheel],
  );

  const { bindFrame } = useFrameInteractions({
    containerRef,
    panStartRef,
    onZoomWheel: handleWheel,
    wheelRootRef: bodyRef,
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

  // 换 html / 换页数 = 换了一份文档：把用户缩放复位（`setZoom` 来自 usePreviewZoom，引用稳定）。
  useEffect(() => {
    setZoom(1);
  }, [html, pageCount, setZoom]);

  /**
   * 量可用空间。**与上面那条拆开**（2026-10-29）：它依赖 `updateAvailableSpace`，而后者会
   * 随 `bodyHeight` 变化重建——合成一条的话，头部一变高（提示条出现、工具条换行）就会顺手
   * 执行 `setZoom(1)`，把用户刚拖到的 150% 悄悄打回 100%。
   */
  useEffect(() => {
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
  }, [updateAvailableSpace]);

  const handleFrameLoad = useCallback(
    (event: SyntheticEvent<HTMLIFrameElement>, index: number) => {
      const frame = event.currentTarget;
      bindFrame(frame);
      applyLayoutToFrame(frame, index);
      setFrameEpoch((current) => current + 1);
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

  return (
    <div className="resume-preview-root">
      {/* 固定头部：工具条 + 专业视图行 + 两条提示；制作台只让纸面滚动，这一层不滚。 */}
      <div className="resume-preview-chrome">
        <ResumePreviewToolbar
          templateControls={templateControls}
          measureControls={measureControls}
          canExactPreview={canExactPreview}
          previewMode={activeMode}
          onPreviewModeChange={changeMode}
          clickToEdit={checked}
          onClickToEditChange={setChecked}
          clickToEditAvailable={available}
          showClickToEdit={showClickToEdit}
        />
        {/* 专业视图工具条（W15）：只在制作台（有 ProviewProvider）且草稿口径下出现；
          主预览与精确模式一行 DOM 都不多。 */}
        {proviewConfig && draftMode ? (
          <ProviewLayer
            viewportRef={containerRef}
            pageCount={pageCount}
            pageWidth={A4_WIDTH_PX}
            pageHeight={A4_HEIGHT_PX}
            zoom={zoom}
            scale={geometry.scale}
            fitScale={geometry.fitScale}
            viewportWidth={geometry.viewportWidth}
            onZoomChange={setZoom}
            frameEpoch={frameEpoch}
          />
        ) : null}
        <PreviewAlerts
          warnings={warnings}
          overflow={overflow}
          overflowClipped={geometry.overflowClipped}
          pagesNeeded={geometry.pagesNeeded}
          pageCount={pageCount}
          overflowAmountText={geometry.overflowAmountText}
          // 精确模式只要**一条**页数提醒：那一栏的结论来自服务端真实 PDF
          // （`ExactPreviewAlerts`），草稿侧这条是浏览器分页的另一套数字。
          mode={activeMode}
        />
      </div>
      {/* 纸张区域：制作台里**只有这一层滚动**——精确模式的多页 PDF 也在这里滚。 */}
      <div className="resume-preview-body" ref={bodyRef}>
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
              // 制作台里还没保存的正文（W04）：没有这一项，精确预览就停在上一版内容。
              content={exactPreview!.content}
              headingSerif={exactPreview!.headingSerif}
              onStatus={setExactStatus}
              height={Math.max(MIN_PREVIEW_HEIGHT, viewportHeight)}
              // 精确模式的缩放与草稿共用同一个 `zoom`：两边都从 100% 起，
              // 用户的心理模型只有"这张纸现在多大"，没有第二套比例。
              scale={zoom}
            />
          </div>
        ) : null}
        {mountDraftCanvas ? (
          <div
            // 精确模式下它只是"测量用的尸体"：看不见、不占位，但仍在排版。
            style={measuringOnly ? { height: 0, overflow: "hidden" } : undefined}
            aria-hidden={measuringOnly || undefined}
          >
            <ResumePreviewCanvas
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
      </div>
      {/* 缩放条是**页脚**：跟着纸面区域一起不出现在滚动流里，制作台里它因此永远贴底
          （2026-10-29：原来是 sticky 在滚动容器里，滚到底会与纸面之间留出一条缝）。 */}
      <PreviewZoomBar
        // 精确模式把页面状态并进这一行；草稿模式没有状态块，缩放条原样居中。
        status={activeMode === "exact" ? exactStatus : null}
        scale={canExactPreview && activeMode === "exact" ? zoom : geometry.scale}
        // `clampedToMin` 的文案说的是"容器装不下"，只对草稿的按宽自适应成立；
        // 精确模式的 50% 是用户自己缩到的，不该冒出一句对不上的解释。
        clampedToMin={canExactPreview && activeMode === "exact" ? false : geometry.clampedToMin}
        hint={zoomHint}
        onZoomOut={() => adjustZoom(-0.1)}
        onZoomIn={() => adjustZoom(0.1)}
        onReset={resetZoom}
      />
      {boldMenu ? <BoldContextMenu {...boldMenu} /> : null}
    </div>
  );
});

export type { ResumePreviewHandle } from "./resume-preview/config";
export type { ExactPreviewOptions } from "./resume-preview/exactPreviewOptions";
export default ResumePreview;
