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
 * 「查看大图」、把滑块拖回原值，走的都是这条路。缓存只存 Blob（见 `exactPreviewCache`），
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
import { readCachedPreview, writeCachedPreview } from "./exactPreviewCache";
import { EXACT_OVERFLOW_NOTE } from "./config";

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

interface Shot {
  /** 这一份是按哪一组参数排的（`formatKey`）：切回同一组参数时据此判定"已经有图了"。 */
  key: string;
  url: string;
  pages: number | null;
  /** 按当前版式真实需要的页数（未截断）。 */
  pagesNeeded: number | null;
  overflow: boolean;
}

/**
 * 当前环境能不能内嵌显示 PDF。
 *
 * `navigator.pdfViewerEnabled` 是 Chromium 96+ 的标准信号：Electron 在
 * `webPreferences.plugins=false`（**默认值**）时为 `false`，某些精简版 Chromium 也是。
 * 那种环境下 `<iframe src="blob:…pdf">` 只会留一块空白——用户完全不知道发生了什么，
 * 所以宁可直接说清楚并给一条"在新标签打开"的出口。
 *
 * 读不到（老浏览器 / 非 Chromium）时按"可以"处理：宁可让查看器自己决定，也不要把
 * 本来能用的环境误判成不能用。
 */
function canShowPdfInline(): boolean {
  if (typeof navigator === "undefined") return true;
  return (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled !== false;
}

/** 模块级求值一次即可：`pdfViewerEnabled` 在同一次页面生命周期里不会变。 */
const INLINE_PDF_OK = canShowPdfInline();

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
}: Props) {
  /** 当前**可见**的那一份（旧图，双缓冲里留在下面）。 */
  const [shown, setShown] = useState<Shot | null>(null);
  /** 正在加载、完全透明的那一份；`onLoad` 后顶替成 `shown`。 */
  const [pending, setPending] = useState<Shot | null>(null);
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
  const shownRef = useRef<Shot | null>(null);
  const pendingRef = useRef<Shot | null>(null);

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
    (shot: Shot) => {
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
    // 已经有这一版：切回精确模式、把滑块拖回原值都走这里，一次请求都不发。
    // `shown` 与 `pending` 都要看——后者是"已经排好、正在等查看器加载"。
    if (shownRef.current?.key === formatKey || pendingRef.current?.key === formatKey) return;

    // 缓存命中：直接上屏，连去抖都不用等。仍然走定时器——effect 体里同步 setState 会
    // 触发级联渲染（`react-hooks/set-state-in-effect`），与下面请求那条路径同一口径。
    const cached = readCachedPreview(formatKey);
    if (cached) {
      const cachedTimer = setTimeout(() => {
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
          if (controller.signal.aborted) return;
          // 这份字节下次（切口径 / 开大图 / 拖回原值）还要用，别再让服务端排一遍。
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
          if (controller.signal.aborted) return;
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
    keep,
    showShot,
  ]);

  /** 新图加载完成：顶替可见层、释放旧 URL、收起"重排中"。 */
  const swapIn = useCallback(() => {
    const shot = pendingRef.current;
    if (!shot) return;
    pendingRef.current = null;
    // 等一帧再换：`onLoad` 只代表文档就绪，紧接着的绘制才让它真正可见。
    requestAnimationFrame(() => {
      const previous = shownRef.current;
      shownRef.current = shot;
      setShown(shot);
      setPending(null);
      release(previous?.url ?? null);
    });
  }, [release]);

  // 兜底：新 PDF 一直不 load（查看器卡住 / 被策略拦）时也要把状态收回来。
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(swapIn, SWAP_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [pending, swapIn]);

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

  /** 请求在飞，或新图还没顶上来——都算"正在重排"，界面必须一直有反馈。 */
  const busy = loading || Boolean(pending);
  const current = shown;

  return (
    <>
      {/* 溢出提示与草稿侧同一口径、同一措辞（2026-10-21 用户要求"对草稿和精确模式都生效"）。
          放在 PDF 相框**上方**：它要说的是"你看到的这份文件已按上限截断"，藏在相框底部
          那行小字里等于没提示。 */}
      {current && current.overflow && !busy ? (
        <Alert
          type="warning"
          showIcon
          className="exact-preview-overflow"
          style={{ marginBottom: 8 }}
          title={`按当前设置约需 ${current.pagesNeeded ?? current.pages ?? "?"} 页（上限 ${pageLimit} 页）。`}
          description={EXACT_OVERFLOW_NOTE}
        />
      ) : null}
      {/* 版本错位：`X-Resume-Pages-Needed` 是 2026-10-21 才有的响应头。旧后端既不返回它，
          又**会自动缩小字号**把内容塞进页数上限。没有这条提示，用户只看到"滑杆 18px、PDF
          却明显更小"，根本猜不到原因是"跑着的后端进程还是旧代码"（2026-10-21 实测踩到）。 */}
      {current && current.pagesNeeded == null ? (
        <Alert
          type="warning"
          showIcon
          className="exact-preview-stale"
          style={{ marginBottom: 8 }}
          title="这版 PDF 可能不是按你设定的字号排的"
          description="运行中的后端是旧版本（没有返回「按当前设置约需几页」），旧版本会自动缩小字号。完全退出应用后重新启动，精确预览就会严格按滑杆上的值排版。"
        />
      ) : null}
      <div className="exact-preview" style={{ height }}>
        {/* 只在这个口径可见时才摆加载占位：草稿模式下这块是隐藏的，占位没有意义
            （而且会让每份简历的弹窗里都多一个空壳）。 */}
        {active && busy && !current ? (
          <LoadingBlock tip="正在按导出引擎排版…" minHeight={height} />
        ) : null}

        {current && INLINE_PDF_OK ? (
          <div className="exact-preview-stack" style={{ height }}>
            <iframe
              // 与导出的 PDF 是同一份字节：这里看到什么，下载下来就是什么。
              src={current.url}
              title="简历精确预览（导出 PDF）"
              className="exact-preview-frame"
              style={{ height }}
            />
            {pending ? (
              // 透明的预加载层：`onLoad` 前谁也看不见它，但浏览器已经在解析新 PDF。
              <iframe
                src={pending.url}
                title="正在加载的精确预览"
                aria-hidden="true"
                tabIndex={-1}
                className="exact-preview-frame exact-preview-frame-pending"
                style={{ height }}
                onLoad={swapIn}
              />
            ) : null}
            {busy ? (
              <div className="exact-preview-overlay" aria-busy="true">
                <span className="exact-preview-overlay-text">正在按新设置重新排版…</span>
              </div>
            ) : null}
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

        {current ? (
          <div className="exact-preview-status" aria-busy={busy}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {/* 重排期间要说话：PDF 是服务端排的、查看器还要重建，改完参数到新图出来之间
                必然有一段空窗——静悄悄留着旧图会让人以为"没生效"。 */}
              {busy
                ? "正在按新设置重新排版…"
                : `精确预览 · 实际 ${current.pages} 页（上限 ${pageLimit} 页）`}
            </Typography.Text>
            <Button
              size="small"
              type="link"
              onClick={() => window.open(current.url, "_blank", "noopener,noreferrer")}
            >
              在新标签打开
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}
