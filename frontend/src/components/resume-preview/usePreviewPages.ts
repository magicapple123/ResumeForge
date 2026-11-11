// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览的**请求状态机**：什么时候问服务端要一版、旧的一版什么时候让位。
 *
 * 从 `ExactPreviewPanel` 拆出（单文件 500 行预算，零豁免）。这里只管状态；DOM 与高度
 * 算式在 `ExactPreviewPages`，相框测量在 `usePreviewFrame`。
 *
 * 四条约束都不是"实现细节"：
 *
 * 1. **请求要去抖**（#23 X2）：拖动滑块的合并窗口是 500ms，拖停才发一次。上游控件
 *    （`StyleValueRow` 等）已经只在 `onChangeComplete`（松手）时提交，所以这 500ms 是
 *    "最后一道保险"：连续改多个参数时把中间态全部合并掉，不要发出几次注定作废的重渲。
 *    **首次打开不排队**——那时手上还没有任何一版，让用户为合并窗口多等半秒是纯亏。
 * 2. **旧请求必须中止**：慢的那次回来得比新的晚，会把新结果覆盖成旧版式（用户改完发现
 *    没变，2026-10-21 实测）。
 * 3. **旧图不能消失**：位图没有"渐进渲染"，换 `src` 的瞬间就是一片白。所以新的一版先当
 *    `pending` 挂着，等它的每一张图都 `onLoad` 再一次性顶上来（`swapIn`）。
 * 4. **世代号**：被作废的那一轮连 `loading` 都不许写。起因是 2026-11-06 的"永久卡在
 *    正在排版"——abort 之后 `.catch` 直接 return、不复位 `loading`，而新 effect 若命中
 *    "已经有这一版"就什么都不做，界面于是永久停在忙碌态。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "../../i18n";
import type { ResumeDocument } from "../../types/resumeDocument";
import { A4_WIDTH_PX } from "./config";
import { readCachedPreview, writeCachedPreview } from "./exactPreviewCache";
import { previewWidthBucket, type PreviewShot } from "./previewPages";
import { fetchResumePreviewPages } from "./previewPagesApi";

/**
 * 参数变化后的合并窗口（见文件头第 1 条）：150 → 500。
 *
 * 一次重渲在旧口径下要 3.9 秒（需求 #23 实测），而拖动时每 150ms 就可能提交一个新值——
 * 结果是"连发六次、六次全部作废，用户一次结果也看不到"。500ms 的窗口把一次拖动收敛成
 * 一次请求；顺手配合 P1/P2 之后单次成本已降到亚秒级，"松手后一秒内有图"才有保证。
 */
const DEBOUNCE_MS = 500;

export interface PreviewPagesParams {
  /** 这块是不是**当前可见**：草稿模式下组件常驻但绝不发请求。 */
  active: boolean;
  resumeId: number;
  template: string;
  formatName: string;
  pageLimit: number;
  fontScale: string;
  language: string;
  formatConfig: Record<string, unknown>;
  /** 正文 + 模板的身份：内容改了也要重排一次。 */
  contentSignature: string;
  /** 还没保存的正文（W04）。 */
  content?: ResumeDocument;
  /** 相框实测宽度（0 = 还没量到 → 按 A4 宽请求）。 */
  width: number;
  /** 设备像素比（决定位图分辨率）。 */
  dpr: number;
}

export interface PreviewPagesState {
  /** 当前**可见**的那一版。 */
  shot: PreviewShot | null;
  /** 已经拿到、图还在载的那一版；渲染层在它全部 `onLoad` 后调 `swapIn`。 */
  pending: PreviewShot | null;
  /** 请求在飞（或新一版还没顶上来）。 */
  loading: boolean;
  error: string | null;
  /** 把 `pending` 顶替成可见层（图已全部就绪时调用）。 */
  swapIn: () => void;
}

export function usePreviewPages(params: PreviewPagesParams): PreviewPagesState {
  const {
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
    width,
    dpr,
  } = params;

  const [shot, setShot] = useState<PreviewShot | null>(null);
  const [pending, setPending] = useState<PreviewShot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * 可见层 / 待换层的**同步镜像**：请求回调与 `swapIn` 都要读"现在显示的是哪一份"，
   * 而 state 在闭包里可能是旧的。也不能在 `setState` 的 updater 里去调另一个 `setState`
   * ——updater 可能被执行多次（StrictMode 就双调），副作用会重复发生。
   */
  const shotRef = useRef<PreviewShot | null>(null);
  const pendingRef = useRef<PreviewShot | null>(null);
  const seqRef = useRef(0);

  // 版式是对象，每次父组件重渲染都可能是新引用；用序列化结果当依赖，
  // 否则"只改了一个无关的状态"也会触发一次完整的服务端重排。
  const configKey = JSON.stringify(formatConfig ?? {});
  // **整套版式都进 key**：模板 / 版式 / 页数 / 字号 / 语言 / 覆盖 / 宽高口径，任何一个变了
  // 都要重排。只盯着一部分（早先只看 config）会让"换了模板、精确预览不动"；漏掉语言则是
  // "切了语言、图一个像素都没变"——服务端明明会重排，只是请求根本没发出去。
  const formatKey = `${contentSignature}|${template}|${formatName}|${pageLimit}|${fontScale}|${language}|${configKey}|${previewWidthBucket(width)}|${dpr}`;
  // 从字符串还原一份稳定引用：请求里要发版式对象，而直接依赖 `formatConfig`
  // 会让父组件每渲染一次就重排一次。
  const normalizedConfig = useMemo(
    () => JSON.parse(configKey) as Record<string, unknown>,
    [configKey],
  );

  /**
   * 把一份"已经拿到的"结果放上屏：第一次直接显示，之后交给渲染层预加载 + `swapIn`。
   * 缓存命中与请求成功共用这一段，两条路径的上屏行为因此不可能不一致。
   */
  const showShot = useCallback((next: PreviewShot) => {
    if (!shotRef.current) {
      shotRef.current = next;
      setShot(next);
      return;
    }
    // 连续改参数时可能已经有一份没加载完的 pending：那份直接作废（图还没上屏，无副作用）。
    pendingRef.current = next;
    setPending(next);
  }, []);

  useEffect(() => {
    // 隐藏（草稿模式）时不排：拖一次草稿滑块不该白排一份看不见的位图。
    if (!active) return;
    // 本轮的世代号：闭包里记着它，异步回来时先问"我还是当代吗"（见文件头第 4 条）。
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    const isCurrent = () => seq === seqRef.current;

    // 已经有这一版：切回精确模式、拖回原值都走这里，一次请求都不发（`shot` 与 `pending`
    // 都要看）。并且必须把"重排中"收回来，否则界面永久停在"正在排版…"。
    if (shotRef.current?.key === formatKey || pendingRef.current?.key === formatKey) {
      const settleTimer = setTimeout(() => {
        if (!isCurrent()) return;
        // 可见的已是目标版本 → 手上这份 pending 一定是另一个版本，不作废它会顶上来。
        if (shotRef.current?.key === formatKey && pendingRef.current) {
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
        showShot({ key: formatKey, ...cached });
      }, 0);
      return () => clearTimeout(cachedTimer);
    }

    const controller = new AbortController();
    // 量不到宽度（首次布局前 / 面板隐藏 / jsdom）时按 A4 宽请求：必须有个确定的数，
    // 否则服务端拿不到分辨率口径。
    const requestWidth = width > 0 ? Math.round(width) : A4_WIDTH_PX;
    // 手上还没有任何一版（第一次打开精确视图）→ 不排队：合并窗口是为"连续改参数"准备
    // 的，第一次看清纸面为它多等半秒是纯亏。此时 `shotRef` 与 `pendingRef` 都为空——上面
    // 两条"已经有这一版"的分支会先 return，所以走到这里就是"真的要问一次服务端"。
    const delay = shotRef.current || pendingRef.current ? DEBOUNCE_MS : 0;

    const timer = setTimeout(() => {
      if (!isCurrent()) return;
      setLoading(true);
      setError(null);
      fetchResumePreviewPages(
        resumeId,
        {
          template,
          format_name: formatName,
          page_limit: pageLimit,
          font_scale: fontScale,
          language,
          format_config: normalizedConfig,
          content,
          width: requestWidth,
          dpr,
        },
        controller.signal,
      )
        .then((meta) => {
          // 两道闸都要过：`aborted` 是"用户还在拖滑块"，`!isCurrent` 是"这一轮已经不是当代"
          // ——被作废的请求一个字都不许写，包括 `loading`（见文件头第 4 条）。
          if (controller.signal.aborted || !isCurrent()) return;
          // 这版下次（切口径 / 开制作台 / 拖回原值）还要用，别再让服务端排一遍。
          writeCachedPreview(formatKey, meta);
          setLoading(false);
          showShot({ key: formatKey, ...meta });
        })
        .catch((err: unknown) => {
          // 取消不是错误：用户还在拖滑块，这次请求本来就该被丢弃。
          if (controller.signal.aborted || !isCurrent()) return;
          setLoading(false);
          setError(err instanceof Error ? err.message : t("preview.exact.errorTitle"));
        });
    }, delay);

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
    content,
    width,
    dpr,
    showShot,
  ]);

  /**
   * 新一版的图全部就绪：顶替可见层。
   *
   * 这里必须再问一次"这份 pending 还是当代吗"（兜底定时器与新一版到达可能只差几毫秒）：
   * 不判 `key` 的话，旧版本会顶上来——切回 A 却看到 B。
   */
  const swapIn = useCallback(() => {
    const next = pendingRef.current;
    if (!next) return;
    if (next.key !== formatKey) {
      pendingRef.current = null;
      setPending(null);
      return;
    }
    pendingRef.current = null;
    // 等一帧再换：`onLoad` 只代表图片解码就绪，紧接着的绘制才让它真正可见。
    requestAnimationFrame(() => {
      shotRef.current = next;
      setShot(next);
      setPending(null);
    });
  }, [formatKey]);

  return { shot, pending, loading, error, swapIn };
}
