// SPDX-License-Identifier: Apache-2.0
/**
 * 「简历制作台」右栏的**实时预览**：内容一变就让服务端重排一次，但不许每敲一个字发一次请求。
 *
 * ## 语义（这一节就是契约，改之前先读）
 *
 * 1. `content` / `layout` 变化 → `state = "typing"`，600ms 防抖；
 * 2. 防抖到期 → 发一次 `render`，`state = "rendering"`；
 * 3. 渲染在飞时又有变化：**只记 `pending`（最新一版），不发请求**；回来之后再跑最后一次——
 *    一轮防抖窗口里"首版 + 末版，最多 2 次"；
 * 4. 每次请求带自增 `seq` 与 `AbortController`；响应回来 `seq` 不是当前值就直接丢弃
 *    （成功与失败都丢）——否则"慢的那一版"会盖掉"新的那一版"，表现为预览忽新忽旧；
 * 5. `enabled` 变 false / 卸载 → abort + 清定时器 + 清 pending，且**不再 setState**；
 * 6. 失败：`state = "error"`，**保留上一次成功的 html**（空白的预览比旧一版的预览糟得多），
 *    `retry()` 重跑最新一版；
 * 7. 成功：`onHtml(html)`；替换前记下滚动位置与内容高度，替换后在一帧内写回
 *    （高度没变就还原像素位置，变了就按比例）——否则每次重排都把用户弹回页首；
 * 8. 与保存的优先级：`suspend()`（保存开始时调）abort 在飞请求、清 pending、状态归 `idle`；
 *    `resume()` 交还控制权。**保存返回的 html 由宿主直接写，本 hook 不得覆盖**——这也是
 *    `suspend` 存在的唯一理由：保存期间回来的实时结果一定是旧的。
 *
 * ## 为什么"首帧不触发"
 *
 * 打开制作台时宿主刚渲染过一份 html，内容与版面与入参完全一致。首帧再发一次同样的请求，
 * 换来的只是 iframe 白屏一下。所以第一轮只记基线。
 *
 * ## 为什么回调都放在 ref 里
 *
 * `render` / `onHtml` 通常是宿主每帧新建的箭头函数。放进依赖会让"内容变了"这条 effect 每帧
 * 重新跑，一次输入变成一次请求——正是本 hook 要消灭的现象。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ResumeContent, ResumeLayout } from "../../types";

/** 状态机：空闲 / 正在输入（防抖中）/ 正在渲染 / 上一次失败。 */
export type ResumeLivePreviewState = "idle" | "typing" | "rendering" | "error";

/** 一次待渲染的"内容 + 版式"快照。 */
export interface ResumeLivePreviewJob {
  content: ResumeContent;
  layout: ResumeLayout;
}

/** 一轮防抖窗口里最多发几次请求（首版 + 末版）。 */
const BURST_BUDGET = 2;

/** 与 `ResumeLayoutControls` 的"拖完就重排"体感一致：短到不像卡顿，长到能合并一次输入。 */
const DEFAULT_DEBOUNCE_MS = 600;

export interface UseResumeLivePreviewOptions {
  /** 制作台打开且中栏可见时为真；为假时一次请求都不发。 */
  enabled: boolean;
  /** 合并 overlay 之后的整份内容。 */
  content: ResumeContent | null;
  layout?: ResumeLayout;
  /** 注入 `api/renderResume`：保留 `signal` 才能真的取消在飞请求。 */
  render: (content: ResumeContent, layout: ResumeLayout, signal: AbortSignal) => Promise<string>;
  onHtml: (html: string) => void;
  onStateChange?: (state: ResumeLivePreviewState) => void;
  /** 滚动容器：替换 html 后按它恢复滚动位置。 */
  scrollRef?: RefObject<HTMLElement | null>;
  /** 防抖窗口（测试用短值；生产用缺省 600ms）。 */
  debounceMs?: number;
}

export interface ResumeLivePreviewApi {
  state: ResumeLivePreviewState;
  /** 失败后重跑最新一版（不自增 epoch，旧响应仍按 `seq` 丢弃）。 */
  retry: () => void;
  /** 保存开始：取消在飞、清 pending、状态归 idle。 */
  suspend: () => void;
  /** 保存结束：交还控制权。 */
  resume: () => void;
}

export function useResumeLivePreview({
  enabled,
  content,
  layout,
  render,
  onHtml,
  onStateChange,
  scrollRef,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseResumeLivePreviewOptions): ResumeLivePreviewApi {
  const [state, setState] = useState<ResumeLivePreviewState>("idle");

  // ── 回调与配置走 ref：见文件头最后一段 ────────────────────────────
  const renderRef = useRef(render);
  const htmlRef = useRef(onHtml);
  const stateCbRef = useRef(onStateChange);
  const scrollRefOf = useRef(scrollRef);
  const debounceRef = useRef(debounceMs);
  useEffect(() => {
    renderRef.current = render;
  }, [render]);
  useEffect(() => {
    htmlRef.current = onHtml;
  }, [onHtml]);
  useEffect(() => {
    stateCbRef.current = onStateChange;
  }, [onStateChange]);
  useEffect(() => {
    scrollRefOf.current = scrollRef;
  }, [scrollRef]);
  useEffect(() => {
    debounceRef.current = debounceMs;
  }, [debounceMs]);

  // ── 状态机（全部是 ref：它们描述"这一帧之外"的事实，不该触发渲染）──
  const pendingRef = useRef<ResumeLivePreviewJob | null>(null);
  const lastJobRef = useRef<ResumeLivePreviewJob | null>(null);
  const inflightRef = useRef(false);
  const seqRef = useRef(0);
  const budgetRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const suspendedRef = useRef(false);
  const disposedRef = useRef(false);
  /** 首帧基线：内容引用 + 版式签名。 */
  const lastContentRef = useRef<ResumeContent | null>(null);
  const lastLayoutRef = useRef<string | null>(null);
  /** `pump` / `rearm` 互相调用（完成后再跑末版 / 预算用完就重新防抖），只能靠 ref 打破环。 */
  const pumpRef = useRef<() => void>(() => undefined);
  const rearmRef = useRef<(job: ResumeLivePreviewJob | null) => void>(() => undefined);

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  /** 写入 html，并把滚动位置按"高度没变就还原、变了按比例"放回去。 */
  const applyHtml = useCallback((html: string) => {
    const node = scrollRefOf.current?.current ?? null;
    const previousTop = node ? node.scrollTop : 0;
    const previousHeight = node ? node.scrollHeight : 0;
    htmlRef.current(html);
    if (!node) return;
    const restore = () => {
      const target = scrollRefOf.current?.current ?? null;
      if (!target) return;
      const nextHeight = target.scrollHeight;
      if (nextHeight <= 0) return;
      target.scrollTop =
        Math.abs(nextHeight - previousHeight) <= 4
          ? Math.min(previousTop, nextHeight)
          : Math.round((previousTop / Math.max(1, previousHeight)) * nextHeight);
    };
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(restore);
    else restore();
  }, []);

  const pump = useCallback(() => {
    if (disposedRef.current || suspendedRef.current) return;
    if (inflightRef.current) return;
    const job = pendingRef.current;
    if (!job) return;
    if (budgetRef.current <= 0) {
      // 这一轮的两次用完了：静默 600ms 之后再开一轮，期间继续合并变化。
      rearmRef.current(null);
      return;
    }
    budgetRef.current -= 1;
    pendingRef.current = null;
    lastJobRef.current = job;
    inflightRef.current = true;
    const seq = ++seqRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setState("rendering");
    void (async () => {
      try {
        const html = await renderRef.current(job.content, job.layout, controller.signal);
        if (seq !== seqRef.current || disposedRef.current) return;
        applyHtml(html);
        setState("idle");
      } catch {
        if (seq !== seqRef.current || disposedRef.current) return;
        // 取消（挂起 / 卸载）不是失败：保留上一版 html，也不弹"失败"。
        if (controller.signal.aborted) return;
        setState("error");
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
        // 旧请求（被挂起 / 被新一版取代）不驱动下一跳：`inflight` 归新请求管。
        if (seq === seqRef.current) {
          inflightRef.current = false;
          if (!disposedRef.current && !suspendedRef.current) pumpRef.current();
        }
      }
    })();
  }, [applyHtml]);

  const rearm = useCallback(
    (job: ResumeLivePreviewJob | null) => {
      if (job) pendingRef.current = job;
      budgetRef.current = BURST_BUDGET;
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        pumpRef.current();
      }, debounceRef.current);
    },
    [clearTimer],
  );

  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);
  useEffect(() => {
    rearmRef.current = rearm;
  }, [rearm]);

  const schedule = useCallback((job: ResumeLivePreviewJob) => {
    pendingRef.current = job;
    setState("typing");
    // 在飞期间不排队：只留最新一版，等这一版回来再跑（首版 + 末版）。
    if (inflightRef.current) return;
    rearmRef.current(null);
  }, []);

  // ── 内容 / 版式变化 → 防抖 ─────────────────────────────────────
  useEffect(() => {
    if (!enabled || !content || !layout) return;
    const signature = JSON.stringify(layout);
    const first = lastContentRef.current === null && lastLayoutRef.current === null;
    if (lastContentRef.current === content && lastLayoutRef.current === signature) return;
    lastContentRef.current = content;
    lastLayoutRef.current = signature;
    // 首帧只记基线：宿主刚渲染过同一份内容，再发一次只是让 iframe 白屏一下。
    // 保存期间（`suspend` 过）也只记基线：宿主保存完会把权威 html 写回来，此刻发请求既多余，
    // 又会让状态条卡在「预览更新中…」（挂起时 `pump` 不跑，攒下的 pending 没人接）。
    if (first || suspendedRef.current) return;
    schedule({ content, layout });
  }, [enabled, content, layout, schedule]);

  /**
   * 保存开始：取消在飞请求、清 pending、状态归 `idle`。
   *
   * 单独成一个动作而不是"再判断一次 enabled"：保存成功后宿主会把 html 换成权威版本，
   * 此时任何在飞的实时结果都必然是旧的（见文件头第 8 条）。
   */
  const suspend = useCallback(() => {
    suspendedRef.current = true;
    clearTimer();
    pendingRef.current = null;
    seqRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    inflightRef.current = false;
    setState("idle");
  }, [clearTimer]);

  const resume = useCallback(() => {
    suspendedRef.current = false;
  }, []);

  // ── 关闭 / 卸载：abort + 清定时器 + 清 pending ──────────────────
  useEffect(() => {
    if (enabled) return;
    // `enabled` 转假 = 这一栏不再需要实时结果，语义与"保存开始"完全一致。
    // suspend 里的 setState("idle") 是对"结果已失效"的确定性收尾：enabled 翻转不
    // 频繁，且此刻 inflight 已被 abort 清空，不存在同帧级联渲染（规则豁免同
    // GenerateResumeModal 的收尾扇出写法）。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    suspend();
  }, [enabled, suspend]);

  useEffect(
    () => () => {
      // 卸载后一律不再 setState：`disposedRef` 是唯一的闸门。
      disposedRef.current = true;
      clearTimer();
      pendingRef.current = null;
      seqRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    [clearTimer],
  );

  useEffect(() => {
    stateCbRef.current?.(state);
  }, [state]);

  const retry = useCallback(() => {
    if (suspendedRef.current || !enabled) return;
    const job = pendingRef.current ?? lastJobRef.current;
    if (!job) return;
    pendingRef.current = job;
    // 失败已经把这一轮的预算用完：至少放行这一次。
    budgetRef.current = Math.max(1, budgetRef.current);
    clearTimer();
    pumpRef.current();
  }, [clearTimer, enabled]);

  return { state, retry, suspend, resume };
}
