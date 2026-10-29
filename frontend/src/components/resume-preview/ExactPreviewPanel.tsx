// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览：**显示的就是导出产物本身**。
 *
 * 草稿预览用 CSS 多列把连续流切成 N 张 A4（`column-count`），断点由浏览器的多列算法决定；
 * 而导出的 PDF 由服务端 `pdf_exporter`（fpdf2）另排一遍。两套引擎的断点规则不同，
 * "预览 2 页、导出 3 页"是结构性的——再怎么调 CSS 也只能让它"更像"，不可能"相同"。
 *
 * 所以要"严格相同"，只有一条路：让预览显示导出产物。这里把服务端排好的 PDF 用
 * `Blob` + `<iframe>` 交给浏览器原生 PDF 查看器——矢量渲染、可缩放、可翻页，零新依赖，
 * 并且与用户点「导出 PDF」下载到的是同一份字节。
 *
 * **双缓冲（2026-10-21）**：换一份 PDF 时浏览器要重建整个查看器（工具栏、页布局、字体），
 * 复杂简历上是肉眼可见的几百毫秒到一秒多。如果直接把 iframe 的 `src` 换掉，这段时间里
 * 用户看到的是一片空白——而加载标志早在 HTTP 请求返回时就关掉了，于是"标志闪一下就消失、
 * 然后干等很久"。现在的做法是：**旧图一直留着可见**，新 PDF 在同一个位置上以完全透明的
 * iframe 预加载，等它 `onLoad` 再一次性换上来。
 *
 * 另外三条约束：**请求要有去抖**（拖滑块时每次 change 都会走到这里）、**旧请求必须中止**
 * （慢的那次回来得比新的晚，会把新结果覆盖成旧版式）、**objectURL 必须释放**。
 *
 * **同一份 PDF 只排一次（2026-10-21）**：`formatKey` 把内容签名与整组版式参数压成一个
 * 稳定字符串，它既是请求依赖也是缓存键（见 `exactPreviewCache`，URL 仍归本组件所有）。
 *
 * `active` 区分"看得见"与"还在页面上"：草稿模式下本组件**保留挂载**（切回来时查看器
 * 不用重建），但绝不发起请求——否则拖一次草稿滑块就会白排一份看不见的 PDF。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { fetchResumePreviewPdf } from "../../api/resumes";
import type { ResumeContent } from "../../types/resume";
import LoadingBlock from "../common/LoadingBlock";
import {
  ExactNoViewer,
  ExactPreviewAlerts,
  ExactPreviewError,
  ExactPreviewStatus,
} from "./ExactPreviewNotes";
import { readCachedPreview, writeCachedPreview, type PreviewShot } from "./exactPreviewCache";
import { A4_WIDTH_PX } from "./config";
import { INLINE_PDF_OK, zoomedPdfUrl } from "./pdfViewerSupport";
import { exactPreviewFrameHeight, useExactPreviewFrameHeight } from "./useExactPreviewFrameHeight";
import ExactPreviewPaper from "./ExactPreviewPaper";
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
   * 正文 + 模板的身份。**改了内容也必须重排一次**——PDF 是服务端按正文排的，
   * 只把版式当依赖会让"改完一段经历、精确预览还是旧内容"（2026-10-21 用户实测）。
   * 用签名而不是 `html` 本身：签名是稳定短串，既能当依赖又不至于每次渲染都新建引用。
   */
  contentSignature: string;
  height: number;
  /**
   * 这块是不是**当前可见**的口径。
   *
   * 草稿模式下本组件不卸载（挂在 `hidden` 容器里），只是置 `false`：既保住已经排好的
   * PDF 与查看器实例，又不让一次看不见的版式变化去触发服务端重排。
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
   * 精确预览由 PDF 查看器按 `#zoom=page-width` 铺满相框，浏览器自己的工具栏只作用于
   * **PDF 那几页**；缩放由**这一层**承担：纸宽按比例改，查看器会重新排一遍
   * （矢量，放大不糊），而不是把位图拉大。
   */
  scale?: number;
  /**
   * 这次要排的正文（W04）。
   *
   * 缺省 = 服务端用记录里已保存的那一版。制作台里中栏改了几句还没保存时，宿主把
   * 草稿内容传进来；`contentSignature` 必须同步换成这份内容的签名，否则缓存键不变、
   * 请求根本不会重发。
   */
  content?: ResumeContent;
  /**
   * 状态行的出口：宿主传了它，本组件就**不再自己渲染**那一行，而是把节点交出去
   * （主预览要把它并进缩放条，省掉一条横栏）。
   */
  onStatus?: (status: ReactNode) => void;
}

/**
 * 参数变化后的合并窗口。
 *
 * 上游（字号 / 行距 / 页边距滑块）自己已经做过"尾随提交"的去抖，这里再等 320ms 是
 * 重复等待——用户改完到看到新图之间凭空多出三分之一秒。150ms 足够盖住同一帧内的连击。
 */
const DEBOUNCE_MS = 150;

/** 新 PDF 迟迟不 load 时的兜底：宁可先换上去，也不要永远停在旧图。 */
const SWAP_FALLBACK_MS = 4000;

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

  /** 当前**可见**的那一份（旧图，双缓冲里留在下面）。 */
  const [shown, setShown] = useState<PreviewShot | null>(null);
  /** 正在加载、完全透明的那一份；`onLoad` 后顶替成 `shown`。 */
  const [pending, setPending] = useState<PreviewShot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** 所有还活着的 objectURL：统一登记、统一释放，避免双缓冲下漏掉某一个。 */
  const urlsRef = useRef(new Set<string>());
  /**
   * 可见层 / 待换层的**同步镜像**。
   *
   * 请求回调与 `onLoad` 里都要读"现在显示的是哪一份"，而 state 在那个时刻可能是旧的
   * （闭包捕获）。更关键的是：不能在 `setState` 的 updater 里去调另一个 `setState` 或
   * 释放 URL——updater 可能被执行多次（StrictMode 就双调），副作用会重复发生。
   */
  const shownRef = useRef<PreviewShot | null>(null);
  const pendingRef = useRef<PreviewShot | null>(null);
  /**
   * 请求的**世代号**：每轮 effect 领一个自增号，异步回调只在自己还是"当代"时写状态。
   * 起因（2026-11-06 实测"永久卡在正在排版"）：abort 之后 `.catch` 直接 return、
   * 不复位 `loading`，而新 effect 若命中"已经有这一版"就什么都不做。
   */
  const seqRef = useRef(0);

  const release = useCallback((url: string | null) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    urlsRef.current.delete(url);
  }, []);

  const keep = useCallback((url: string) => {
    urlsRef.current.add(url);
    return url;
  }, []);

  // 版式是对象，每次父组件重渲染都可能是新引用；用序列化结果当依赖，
  // 否则"只改了一个无关的状态"也会触发一次完整的 PDF 重排。
  const configKey = JSON.stringify(formatConfig ?? {});
  // **整套版式都进 key**：模板 / 版式 / 页数 / 字号 / 语言 / 覆盖，任何一个变了都要重排。
  // 只盯着一部分（早先只看 config）会让"换了模板、精确预览不动"；漏掉语言则是
  // "切了语言、PDF 一个像素都没变"——服务端明明会重排，只是请求根本没发出去。
  const formatKey = `${contentSignature}|${template}|${formatName}|${pageLimit}|${fontScale}|${language}|${configKey}`;
  // 从字符串还原一份稳定引用：effect 里要用版式对象，而直接依赖 `formatConfig`
  // 会让父组件每渲染一次就重排一次 PDF（对象引用每次都新）。
  const normalizedConfig = useMemo(
    () => JSON.parse(configKey) as Record<string, unknown>,
    [configKey],
  );

  // 卸载时把没释放的 URL 全清掉。
  useEffect(
    () => () => {
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
      urlsRef.current.clear();
    },
    [],
  );

  /**
   * 把一份"已经拿到的"结果放上屏。
   *
   * 第一次（还没有任何图）直接显示；之后走双缓冲：新图以透明 iframe 预加载、`onLoad`
   * 后再顶替——用户全程有东西看。缓存命中与请求成功共用这一段，两条路径的上屏行为
   * 因此不可能不一致。
   */
  const showShot = useCallback(
    (shot: PreviewShot) => {
      if (!shownRef.current) {
        shownRef.current = shot;
        setShown(shot);
        return;
      }
      // 连续改参数时可能已经有一份没加载完的 pending：那份直接作废。
      release(pendingRef.current?.url ?? null);
      pendingRef.current = shot;
      setPending(shot);
    },
    [release],
  );

  useEffect(() => {
    // 隐藏（草稿模式）时不排：拖一次草稿滑块不该白排一份看不见的 PDF。
    if (!active) return;
    // 本轮的世代号：闭包里记着它，异步回来时先问"我还是当代吗"（见 `seqRef` 的注释）。
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    const isCurrent = () => seq === seqRef.current;

    // 已经有这一版：切回精确模式、拖回原值都走这里，一次请求都不发（`shown` 与 `pending`
    // 都要看）。并且必须把"重排中"收回来，否则界面永久停在"正在按新设置重新排版…"。
    if (shownRef.current?.key === formatKey || pendingRef.current?.key === formatKey) {
      const settleTimer = setTimeout(() => {
        if (!isCurrent()) return;
        // 可见的已是目标版本 → 手上这份 pending 一定是另一个版本，不作废它会顶上来。
        if (shownRef.current?.key === formatKey && pendingRef.current) {
          release(pendingRef.current.url);
          pendingRef.current = null;
          setPending(null);
        }
        setLoading(false);
      }, 0);
      return () => clearTimeout(settleTimer);
    }

    // 缓存命中：直接上屏，连去抖都不用等。仍然走定时器——effect 体里同步 setState 会
    // 触发级联渲染（`react-hooks/set-state-in-effect`），与下面请求那条路径同一口径。
    const cached = readCachedPreview(formatKey);
    if (cached) {
      const cachedTimer = setTimeout(() => {
        if (!isCurrent()) return;
        setLoading(false);
        setError(null);
        showShot({
          key: formatKey,
          blob: cached.blob,
          url: keep(URL.createObjectURL(cached.blob)),
          pages: cached.pages,
          pagesNeeded: cached.pagesNeeded,
          overflow: cached.overflow,
        });
      }, 0);
      return () => clearTimeout(cachedTimer);
    }

    const controller = new AbortController();

    // 置"加载中"放在去抖之后：effect body 里同步 setState 会触发级联渲染
    // （`react-hooks/set-state-in-effect`）。
    const timer = setTimeout(() => {
      if (!isCurrent()) return;
      setLoading(true);
      setError(null);
      fetchResumePreviewPdf(
        resumeId,
        {
          template,
          format_name: formatName,
          page_limit: pageLimit,
          font_scale: fontScale,
          language,
          format_config: normalizedConfig,
          content,
        },
        controller.signal,
      )
        .then((result) => {
          // 两道闸都要过：`aborted` 是"用户还在拖滑块"，`!isCurrent` 是"这一轮已经不是当代"
          // ——被作废的请求一个字都不许写，包括 `loading`（见 `seqRef` 的注释）。
          if (controller.signal.aborted || !isCurrent()) return;
          // 这份字节下次（切口径 / 开制作台 / 拖回原值）还要用，别再让服务端排一遍。
          writeCachedPreview(formatKey, {
            blob: result.blob,
            pages: result.pages,
            pagesNeeded: result.pagesNeeded,
            overflow: result.overflow,
          });
          setLoading(false);
          showShot({
            key: formatKey,
            blob: result.blob,
            url: keep(URL.createObjectURL(result.blob)),
            pages: result.pages,
            pagesNeeded: result.pagesNeeded,
            overflow: result.overflow,
          });
        })
        .catch((err: unknown) => {
          // 取消不是错误：用户还在拖滑块，这次请求本来就该被丢弃。
          if (controller.signal.aborted || !isCurrent()) return;
          setLoading(false);
          setError(err instanceof Error ? err.message : t("preview.exact.errorTitle"));
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    active,
    resumeId,
    template,
    formatName,
    pageLimit,
    fontScale,
    language,
    formatKey,
    normalizedConfig,
    release,
    keep,
    showShot,
  ]);

  /**
   * 新图加载完成：顶替可见层、释放旧 URL、收起"重排中"。
   * 这里必须再问一次"这份 pending 还是当代吗"（`onLoad` 与兜底定时器都可能在新旧版本
   * 之间那几毫秒里到达）：不判 `key` 的话，旧版本会顶上来——切回 A 却看到 B。
   */
  const swapIn = useCallback(() => {
    const shot = pendingRef.current;
    if (!shot) return;
    if (shot.key !== formatKey) {
      release(shot.url);
      pendingRef.current = null;
      setPending(null);
      return;
    }
    pendingRef.current = null;
    // 等一帧再换：`onLoad` 只代表文档就绪，紧接着的绘制才让它真正可见。
    requestAnimationFrame(() => {
      const previous = shownRef.current;
      shownRef.current = shot;
      setShown(shot);
      setPending(null);
      release(previous?.url ?? null);
    });
  }, [release, formatKey]);

  // 兜底：新 PDF 一直不 load（查看器卡住 / 被策略拦）时也要把状态收回来。
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(swapIn, SWAP_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [pending, swapIn]);

  /** 请求在飞，或新图还没顶上来——都算"正在重排"，界面必须一直有反馈。 */
  const busy = loading || Boolean(pending);
  const current = shown;
  // PDF 实际排出来的页数。`null` 时**按 1 页算**，不按 0：老后端不返回 `X-Resume-Pages`
  // 时按 0 算会得到 `pageLimit - 0` 张空白纸，把"不知道"放大成"一页都没有"；按 1 算是
  // 唯一诚实的下界（用户 2026-10-23 反馈"选了 3 页却没补白纸"，成因就是走了 `?? 0`）。
  const renderedPages = current ? (current.pages ?? 1) : 0;

  // 高度按**实际页数**算（算式见 `useExactPreviewFrameHeight`），必须在提前 `return` 之前调用。
  const { frameRef, frameHeight, frameWidth } = useExactPreviewFrameHeight(
    renderedPages,
    height,
    scale,
  );
  /**
   * 缩放用 CSS `zoom`：它让整棵子树**重新布局**，PDF 查看器按新的设备比例重绘（清晰）。
   * 另两条路都试过、都不行——改 iframe 尺寸（Chrome 在 iframe 里忽略 `#zoom=page-width`，纸恒定 100%）与 `transform: scale()`（拉大位图，糊）。
   */
  const scalable = frameWidth > 0;
  const baseHeight = scalable
    ? exactPreviewFrameHeight(frameWidth, renderedPages, height)
    : frameHeight;
  const paperWidth = scalable ? Math.round(frameWidth * scale) : 0;
  const paperHeight = scalable ? Math.round(baseHeight * scale) : frameHeight;
  /** 缩放走查看器自己的 `#zoom=<百分比>`（唯一既真缩放又清晰的路径，见 `zoomedPdfUrl`），
   *  每换一档都换一个新 objectURL；iframe 至少与相框同宽，放大时的横向滚动交给 `.is-zoomed`。 */
  const zoomPct = scalable ? Math.max(10, Math.round((100 * paperWidth) / A4_WIDTH_PX)) : null;
  const viewWidth = Math.max(frameWidth, paperWidth);
  const framedUrl = useMemo(
    () => (current ? zoomedPdfUrl(current, zoomPct) : null),
    [current, zoomPct],
  );
  const pendingUrl = useMemo(
    () => (pending ? zoomedPdfUrl(pending, zoomPct) : null),
    [pending, zoomPct],
  );
  // 每换一档缩放都会造新的 objectURL：旧的必须释放，否则每次缩放都留一份 PDF 的内存。
  useEffect(
    () => () => {
      for (const url of [framedUrl, pendingUrl]) {
        if (url?.startsWith("blob:")) URL.revokeObjectURL(url.split("#")[0]);
      }
    },
    [framedUrl, pendingUrl],
  );

  /**
   * 状态行（实际页数 / 在新标签打开 / 字族与未保存说明）**由宿主决定放哪**：
   * 主预览把它并进缩放条那一行；`onStatus` 缺省时仍渲染在这块的最后（老行为）。
   * 元素用 memo 固定引用——它进 effect 依赖，每次渲染新建会让宿主每帧 setState。
   */
  const statusNode = useMemo(
    () =>
      current ? (
        <ExactPreviewStatus
          current={current}
          busy={busy}
          pageLimit={pageLimit}
          headingSerif={headingSerif}
          active={active}
          hasUnsavedContent={Boolean(content)}
          onOpenInNewTab={() => window.open(current.url, "_blank", "noopener,noreferrer")}
        />
      ) : null,
    [active, busy, content, current, headingSerif, pageLimit],
  );
  useEffect(() => {
    onStatus?.(statusNode);
  }, [onStatus, statusNode]);

  if (error) return <ExactPreviewError error={error} />;

  return (
    <>
      <ExactPreviewAlerts current={current} busy={busy} pageLimit={pageLimit} />
      {/* 相框高度由 `useExactPreviewFrameHeight` 给。`is-zoomed` 只在**放大**（scale > 1）时挂上：
          100% 时纸列宽度恰好等于相框宽，半像素误差会让 `overflow-x: auto` 凭空多出一条横向滚动条。 */}
      <div
        className={`exact-preview${scale > 1 ? " is-zoomed" : ""}`}
        ref={frameRef}
        // 缩小停在 fit 高度、放大才跟着长（见 `useExactPreviewFrameHeight` 的「相框高度」那节）。
        style={scalable ? { height: frameHeight } : undefined}
      >
        {/* 只在这个口径可见时才摆加载占位：草稿模式下这块是隐藏的，占位没有意义
            （而且会让每份简历的弹窗里都多一个空壳）。 */}
        {active && busy && !current ? (
          <LoadingBlock tip={t("preview.exact.typesetting")} minHeight={height} />
        ) : null}
        {current && INLINE_PDF_OK ? (
          <ExactPreviewPaper
            current={current}
            pending={pending}
            framedUrl={framedUrl}
            pendingUrl={pendingUrl}
            renderedPages={renderedPages}
            frameHeight={frameHeight}
            paperHeight={paperHeight}
            viewWidth={viewWidth}
            scale={scale}
            scalable={scalable}
            busy={busy}
            onSwapIn={swapIn}
          />
        ) : null}

        {current && !INLINE_PDF_OK ? <ExactNoViewer url={current.url} /> : null}
      </div>
      {/* 状态行交给宿主的那一半（`onStatus`）：主预览把它并进**缩放条同一行**（2026-10-29
          用户要求"这两行放到一行"），制作台右栏空间窄，并进去之后自然会折成两行，高度不变。
          宿主没接（`onStatus` 缺省）时仍按老位置渲染在这里——单测与只读宿主不用改 */}
      {onStatus ? null : statusNode}
    </>
  );
}
