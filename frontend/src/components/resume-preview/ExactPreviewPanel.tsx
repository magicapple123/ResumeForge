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
 * iframe 预加载，等它 `onLoad` 再一次性换上来。用户全程有东西看，等待感被"旧图 → 新图"
 * 的瞬时切换替代。
 *
 * 另外三条约束：
 * - **请求要有去抖**：用户拖字号滑块时每次 change 都会走到这里，逐帧发请求会把后端排满；
 * - **旧请求必须中止**：慢的那次回来得比新的晚，会把新结果覆盖成旧版式（经典的竞态）；
 * - **objectURL 必须释放**：每次请求生成一个，不释放就是整份 PDF 的内存泄漏。
 *
 * **同一份 PDF 只排一次（2026-10-21）**：`formatKey` 把内容签名与整组版式参数压成一个
 * 稳定字符串，它既是请求依赖也是缓存键。已经有这一版就不再请求——切回精确模式、打开
 * 「简历制作台」、把滑块拖回原值，走的都是这条路。缓存只存 Blob（见 `exactPreviewCache`），
 * URL 仍归本组件所有。
 *
 * `active` 区分"看得见"与"还在页面上"：草稿模式下本组件**保留挂载**（这样切回来时
 * PDF 查看器不用重建、画面不会空一下），但绝不发起请求——否则拖一次草稿滑块就会白排
 * 一份看不见的 PDF。
 */
import { Alert, Button, Space, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchResumePreviewPdf } from "../../api/resumes";
import LoadingBlock from "../common/LoadingBlock";
import { ExactPreviewAlerts, ExactPreviewStatus } from "./ExactPreviewNotes";
import { readCachedPreview, writeCachedPreview, type PreviewShot } from "./exactPreviewCache";
import { INLINE_PDF_OK, withPageWidthZoom } from "./pdfViewerSupport";
import { useExactPreviewFrameHeight } from "./useExactPreviewFrameHeight";
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
}: Props) {
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
          setError(err instanceof Error ? err.message : "精确预览生成失败");
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

  // 高度按**实际页数**算（算式见 `useExactPreviewFrameHeight`）；必须在提前 `return` 之前调用。
  // 纸宽 = 相框宽 × 缩放：PDF 查看器按 `#zoom=page-width` 铺满 iframe，所以把 iframe 宽度
  // 按比例改掉，查看器会**重新排一遍**（矢量，放大不糊），而不是把位图拉大。
  const { frameRef, frameHeight } = useExactPreviewFrameHeight(renderedPages, height, scale);

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        title="精确预览生成失败"
        description={
          <Space orientation="vertical" size={4}>
            <Typography.Text>{error}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              草稿预览不受影响，切换回「草稿」即可继续编辑。导出 PDF 很可能是同一个原因
              （最常见的是本机缺少中文字体）。
            </Typography.Text>
          </Space>
        }
      />
    );
  }

  return (
    <>
      <ExactPreviewAlerts current={current} busy={busy} pageLimit={pageLimit} />
      {/* 相框**不设**高度：高度只给 stack（纸）与 iframe，外层自然包住"纸 + 状态行"——写死会裁掉状态行。 */}
      <div className="exact-preview" ref={frameRef}>
        {/* 只在这个口径可见时才摆加载占位：草稿模式下这块是隐藏的，占位没有意义
            （而且会让每份简历的弹窗里都多一个空壳）。 */}
        {active && busy && !current ? (
          <LoadingBlock tip="正在按导出引擎排版…" minHeight={height} />
        ) : null}

        {current && INLINE_PDF_OK ? (
          /* 缩放靠**改纸宽**而不是 `transform: scale()`：PDF 查看器按 `page-width` 铺满
             iframe，宽度一变它就重新排一遍（矢量，放大不糊）；而 `transform` 只是把位图
             拉大，还会让"外层高度"与"看得见的纸"脱节。
             只画**实际排出来的页**：PDF 里没有的页这里也不补（2026-10-24 用户口径：
             "多页状态下后面补出来的空白页要去掉"），预览与下载到的文件永远一致。 */
          <div className="exact-preview-paper-column" style={{ width: `${scale * 100}%` }}>
            <div
              className="exact-preview-stack"
              style={{ height: frameHeight }}
              // jsdom 量不出像素，把"这版实际几页 / 相框多高"写进 data 属性供测试断言。
              data-pages={renderedPages}
              data-frame-height={frameHeight}
            >
              <iframe
                // 与导出的 PDF 是同一份字节。`#zoom=page-width` 是相框高度的契约（见 `withPageWidthZoom`）。
                src={withPageWidthZoom(current.url)}
                title="简历精确预览（导出 PDF）"
                className="exact-preview-frame"
                style={{ height: frameHeight }}
              />
              {pending ? (
                // 透明的预加载层：`onLoad` 前谁也看不见它，但浏览器已经在解析新 PDF。
                <iframe
                  src={withPageWidthZoom(pending.url)}
                  title="正在加载的精确预览"
                  aria-hidden="true"
                  tabIndex={-1}
                  className="exact-preview-frame exact-preview-frame-pending"
                  style={{ height: frameHeight }}
                  onLoad={swapIn}
                />
              ) : null}
              {busy ? (
                <div className="exact-preview-overlay" aria-busy="true">
                  <span className="exact-preview-overlay-text">正在按新设置重新排版…</span>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {current && !INLINE_PDF_OK ? (
          <div style={{ padding: 16 }}>
            <Alert
              type="info"
              showIcon
              title="当前环境没有内置 PDF 查看器"
              description={
                <Space orientation="vertical" size={6}>
                  <Typography.Text>
                    PDF 已经按导出引擎排好了，但这里没法直接嵌在页面里显示。点下面的按钮用系统的 PDF
                    阅读器打开——内容与点「导出」下载到的完全一样。
                  </Typography.Text>
                  <Button
                    type="primary"
                    onClick={() => window.open(current.url, "_blank", "noopener,noreferrer")}
                  >
                    用系统阅读器打开
                  </Button>
                </Space>
              }
            />
          </div>
        ) : null}
      </div>
      {/* 状态行是**整块预览的页脚**，不是相框的一部分：放进 `.exact-preview` 会在
          最后一页纸上盖一条横栏（草稿模式也把页码条放在整块最底部）。 */}
      {current ? (
        <ExactPreviewStatus
          current={current}
          busy={busy}
          pageLimit={pageLimit}
          headingSerif={headingSerif}
          active={active}
          onOpenInNewTab={() => window.open(current.url, "_blank", "noopener,noreferrer")}
        />
      ) : null}
    </>
  );
}
