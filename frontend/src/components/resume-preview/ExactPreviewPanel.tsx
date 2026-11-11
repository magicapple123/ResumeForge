// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览：**显示的就是导出产物本身**。
 *
 * 草稿预览用 CSS 多列把连续流切成 N 张 A4（`column-count`），断点由浏览器的多列算法决定；
 * 而导出的 PDF 由服务端 `pdf_exporter`（fpdf2）另排一遍。两套引擎的断点规则不同，
 * "预览 2 页、导出 3 页"是结构性的——再怎么调 CSS 也只能让它"更像"，不可能"相同"。
 *
 * 所以要"严格相同"，只有一条路：让预览显示导出产物。服务端把这一版 PDF 的每一页渲染成
 * WebP（`/preview-pages`），这里逐页铺开成 `<img>`：矢量渲染换成了足够密的位图（
 * `width × dpr × 2`，200% 缩放仍有 1:1 像素），换来的是**没有任何不属于我们的装饰**。
 *
 * 2026-11（P3-2）之前用的是 `<iframe src="blob:…pdf">` + 浏览器内置查看器。产物同样逐
 * 字节相同，但查看器在纸边画 4px 深色描边、在右侧与底部各画一条自己的滚动条（外层
 * `.exact-preview` 在 100% 时 `overflow: visible`，根本不具备滚动能力，那两条条只可能
 * 来自它自己的文档），还占掉 56px 高度当工具栏。**无头 Chromium 下它干脆不出图**，
 * 于是"精确预览长什么样"从来没进过 CI 的视野。三样问题在图片化后一次消失。
 *
 * 请求侧的四条约束（去抖 / 作废旧请求 / 旧图不消失 / 世代号）在 `usePreviewPages` 里，
 * 纸面与双缓冲在 `ExactPreviewPages` 里，相框测量在 `usePreviewFrame` 里——这个文件只剩
 * "把它们串起来"。
 */
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumeDocument } from "../../types/resumeDocument";
import LoadingBlock from "../common/LoadingBlock";
import { ExactPreviewAlerts, ExactPreviewError, ExactPreviewStatus } from "./ExactPreviewNotes";
import ExactPreviewPages from "./ExactPreviewPages";
import { A4_WIDTH_PX } from "./config";
import { previewPagesHeight, previewPdfUrl } from "./previewPages";
import { useDevicePixelRatio, usePreviewFrame } from "./usePreviewFrame";
import { usePreviewPages } from "./usePreviewPages";

/**
 * PDF 里相邻两页之间的间距（px），计入相框高度。
 *
 * 从前端接 PDF 查看器那会儿实测出来的一档（查看器自己排页时留的那道缝）。图片化之后
 * 页间距由我们自己画，**沿用 8** 是为了不改变用户已经习惯的疏密——它不属于本次要修的
 * 那几条，顺手改掉只会让对比截图多出无关差异。刻意不用草稿的 `PAGE_STACK_GAP_PX`=24：
 * 那是草稿多页堆叠的未缩放间距，精确预览沿用它会让相框凭空长出两倍多的空白。
 */
const FRAME_PAGE_GAP_PX = 8;

/** 新一版的图迟迟不就绪时的兜底：宁可先换上去，也不要永远停在旧图。 */
const SWAP_FALLBACK_MS = 4000;

interface Props {
  resumeId: number;
  /** 草稿的模板名（内置或自制）：换完还没保存也要按新的排。 */
  template: string;
  /** 草稿的版式名（决定"预设那一层"）。 */
  formatName: string;
  /** 草稿页数上限：与用户点「导出」时用的是同一个值。 */
  pageLimit: number;
  fontScale: string;
  /**
   * 纸面文案的语言：只影响小节标题与字段名，**但它改了纸面内容**，所以必须进缓存键。
   *
   * 缺省 `zh-CN`：本面板的唯一宿主（`ResumePreview`）一定会传（`ExactPreviewOptions` 里
   * 该字段是**必填**），缺省值只是为了不把既有测试的每一处构造点都改成必填——
   * 它与后端 `DEFAULT_RESUME_LANGUAGE` 同一口径，回落方向永远安全。
   */
  language?: string;
  /** 草稿版式（未保存也生效）：拖完滑块立刻能在这里看到结果。 */
  formatConfig: Record<string, unknown>;
  /**
   * 正文 + 模板的身份。**改了内容也必须重排一次**——位图是服务端按正文排的，
   * 只把版式当依赖会让"改完一段经历、精确预览还是旧内容"（2026-10-21 用户实测）。
   * 用签名而不是 `html` 本身：签名是稳定短串，既能当依赖又不至于每次渲染都新建引用。
   */
  contentSignature: string;
  /** 首屏占位高度（还没有任何一版时用它撑住，避免下面内容跳一下）。 */
  height: number;
  /**
   * 这块是不是**当前可见**的口径。
   *
   * 草稿模式下本组件不卸载（挂在 `hidden` 容器里），只是置 `false`：既保住已经拿到的
   * 那一版，又不让一次看不见的版式变化去触发服务端重排。
   */
  active?: boolean;
  /**
   * 这个模板的标题字族是衬线（`elegant` / `editorial`）。
   *
   * 精确预览用嵌入 PDF 的中文黑体，草稿里的衬线标题是 CSS 字族——两条链路在这里**必然
   * 不同**，而用户看到"标题字变了"只会以为出了问题。为真时状态行常驻一句说明（P1-2）；
   * 切回草稿（`active=false`）或换到非衬线模板后它自然消失，不需要额外的状态。
   */
  headingSerif?: boolean;
  /**
   * 整块纸张的缩放（1 = 适应宽度）。
   *
   * 缩放**只改纸的显示宽度**：位图按 `width × dpr × 2` 渲染，放大到 200% 仍按 1:1 像素
   * 显示。相框高度跟着页高走（`max(1, scale)`：缩小停在"整页可见"的高度，放大才跟着长，
   * 与 Ctrl+滚轮的心理模型一致）。
   */
  scale?: number;
  /**
   * 这次要排的正文（W04）。
   *
   * 缺省 = 服务端用记录里已保存的那一版。制作台里中栏改了几句还没保存时，宿主把
   * 草稿内容传进来；`contentSignature` 必须同步换成这份内容的签名，否则缓存键不变、
   * 请求根本不会重发。
   */
  content?: ResumeDocument;
  /**
   * 状态行的出口：宿主传了它，本组件就**不再自己渲染**那一行，而是把节点交出去
   * （主预览要把它并进缩放条，省掉一条横栏）。
   */
  onStatus?: (status: ReactNode) => void;
}

export default function ExactPreviewPanel({
  resumeId,
  template,
  formatName,
  pageLimit,
  fontScale,
  language = "zh-CN",
  formatConfig,
  contentSignature,
  height,
  active = true,
  headingSerif = false,
  scale = 1,
  content,
  onStatus,
}: Props) {
  useLocale();

  const { frameRef, frameWidth } = usePreviewFrame();
  const dpr = useDevicePixelRatio();
  const { shot, pending, loading, error, swapIn } = usePreviewPages({
    active,
    resumeId,
    template,
    formatName,
    pageLimit,
    fontScale,
    language,
    formatConfig,
    contentSignature,
    content,
    width: frameWidth,
    dpr,
  });

  /**
   * 纸的布局宽：量到宽度就按它，量不到（首次布局前 / 隐藏 / jsdom）退回 A4 宽。
   * **取整**是刻意的：非整数宽会让「纸宽 === 相框宽」变成"多半个像素"，`overflow-x: auto`
   * 就会凭空多出一条横向滚动条（2026-11 反馈"精确预览有时候可以左右滑动"）。
   */
  const layoutWidth = frameWidth > 0 ? Math.floor(frameWidth) : A4_WIDTH_PX;
  /** 单页在屏幕上的宽：缩放只作用在这一项上（图片由 CSS 缩放，不重渲）。 */
  const pageWidth = Math.max(1, Math.floor(layoutWidth * scale));
  /** 页间距随缩放一起变，否则放大时两页之间的缝会显得越来越细。 */
  const gap = Math.max(0, Math.round(FRAME_PAGE_GAP_PX * scale));
  /**
   * 相框高度 = 这一叠纸的实际高度：**必须与画出来的页用同一组数**（同一个宽度、同一个
   * 间距、同一个取整函数）。差 1–2px 就会让 `scrollHeight` 比 `clientHeight` 多出一点，
   * 于是放大后除了那条允许的横向滚动条，还会多出一条纵向的——正是本次要根治的现象。
   *
   * 缩小（`scale < 1`）时按**未缩放**的宽度与间距算：相框停在"整页可见"的高度，
   * 与 Ctrl+滚轮的心理模型一致（纸变小、相框不跳），多出来的空白在纸的下方。
   */
  const stackScale = Math.max(1, scale);
  const stackWidth = Math.max(1, Math.floor(layoutWidth * stackScale));
  const stackGap = Math.max(0, Math.round(FRAME_PAGE_GAP_PX * stackScale));
  const stackHeight = shot ? previewPagesHeight(shot.pages, stackWidth, stackGap) : 0;

  /** 请求在飞，或新一版还没顶上来——都算"正在重排"，界面必须一直有反馈。 */
  const busy = loading || Boolean(pending);

  // 兜底：某张图既不 load 也不 error（网络挂起）时也要把状态收回来。
  // `swapIn` 随 `formatKey` 记忆化，所以这个定时器不会因为父组件重渲染而反复重置。
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(swapIn, SWAP_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [pending, swapIn]);

  /**
   * 状态行（实际页数 / 在新标签打开 / 字族与未保存说明）**由宿主决定放哪**：
   * 主预览把它并进缩放条那一行；`onStatus` 缺省时仍渲染在这块的最后（老行为）。
   * 元素用 memo 固定引用——它进 effect 依赖，每次渲染新建会让宿主每帧 setState。
   */
  const statusNode = useMemo(
    () =>
      shot ? (
        <ExactPreviewStatus
          current={shot}
          busy={busy}
          pageLimit={pageLimit}
          headingSerif={headingSerif}
          active={active}
          hasUnsavedContent={Boolean(content)}
          // 图片化之后页面上没有可打开的 blob 了：改指向服务端那份同字节 PDF。
          onOpenInNewTab={() =>
            window.open(previewPdfUrl(resumeId, shot.token), "_blank", "noopener,noreferrer")
          }
        />
      ) : null,
    [active, busy, content, headingSerif, pageLimit, resumeId, shot],
  );
  useEffect(() => {
    onStatus?.(statusNode);
  }, [onStatus, statusNode]);

  if (error) return <ExactPreviewError error={error} />;

  return (
    <>
      <ExactPreviewAlerts current={shot} busy={busy} pageLimit={pageLimit} />
      {/* `is-zoomed` 只在**放大**（scale > 1）时挂上：100% 时纸宽恰好等于相框宽，
          半像素误差会让 `overflow-x: auto` 凭空多出一条横向滚动条。放大时那一条横向滚动
          是**唯一允许**存在的滚动条，纵向永远交给按页数算好的高度（见 P3-3）。 */}
      <div
        className={`exact-preview${scale > 1 ? " is-zoomed" : ""}`}
        ref={frameRef}
        style={stackHeight > 0 ? { height: stackHeight } : undefined}
      >
        {/* 只在这个口径可见时才摆加载占位：草稿模式下这块是隐藏的，占位没有意义
            （而且会让每份简历的弹窗里都多一个空壳）。 */}
        {active && busy && !shot ? (
          <LoadingBlock tip={t("preview.exact.typesetting")} minHeight={height} />
        ) : null}
        {shot ? (
          <ExactPreviewPages
            resumeId={resumeId}
            current={shot}
            pending={pending}
            pageWidth={pageWidth}
            gap={gap}
            stackHeight={stackHeight}
            busy={busy}
            onPendingReady={swapIn}
          />
        ) : null}
      </div>
      {/* 状态行交给宿主的那一半（`onStatus`）：主预览把它并进**缩放条同一行**（2026-10-29
          用户要求"这两行放到一行"），制作台右栏空间窄，并进去之后自然会折成两行，高度不变。
          宿主没接（`onStatus` 缺省）时仍按老位置渲染在这里——单测与只读宿主不用改 */}
      {onStatus ? null : statusNode}
    </>
  );
}
