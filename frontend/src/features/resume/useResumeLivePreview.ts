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
 * ## 两个闸门必须分开（`saveSuspendedRef` / `modePausedRef`）
 *
 * "保存开始"与"`enabled` 变假"的**后果相同、恢复路径不同**：前者由宿主在保存结束时叫
 * `resume()`，后者由下一次 `enabled` 变真自己恢复。合成一个 `suspendedRef` 时，`enabled`
 * 变真没有任何路径把它置回假值——切到「精确」再由「草稿」切回来，`pump()` 第一行就
 * `return`，之后每一次编辑都只写 `pending` 而不发请求，界面静默冻结（本批问题 12）。
 *
 * 所以拆成两个 ref，`pump` / `retry` / `finally` 三个守卫同时看它们：
 *
 * - `saveSuspendedRef`：只由 `suspend()` / `resume()` 翻转，语义是"保存结果优先"；
 * - `modePausedRef`：只由 `enabled` 翻转驱动，语义是"这一栏暂时不需要实时结果"。
 *
 * `enabled` 变真时走 `reconcile()`（保存结束也走它）：比对"最新入参"与"真的排过的那一版"，
 * 不一致才补排一次。两者共用同一段比对，避免"保存期间改内容 / 精确模式期间改内容"两条
 * 路径各写一份。**保存挂起中 `reconcile()` 直接返回**：否则它会解除保存的沉默，让实时渲染
 * 抢在保存结果前面上屏。
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
import type { ResumeDocument, ResumeLayout } from "../../types";

/** 状态机：空闲 / 正在输入（防抖中）/ 正在渲染 / 上一次失败。 */
export type ResumeLivePreviewState = "idle" | "typing" | "rendering" | "error";

/** 一次待渲染的"内容 + 版式"快照。 */
export interface ResumeLivePreviewJob {
  content: ResumeDocument;
  layout: ResumeLayout;
}

/** 一轮防抖窗口里最多发几次请求（首版 + 末版）。 */
const BURST_BUDGET = 2;

/** 与 `ResumeLayoutControls` 的"拖完就重排"体感一致：短到不像卡顿，长到能合并一次输入。 */
const DEFAULT_DEBOUNCE_MS = 600;

/**
 * 从节点向上找真正的滚动容器（overflow-y 可滚且内容超出）。
 *
 * 制作台传给 hook 的 scrollRef 指向 .resume-wb-canvas-scroll——它自己 overflow:hidden，
 * 真正滚的是外层弹窗正文（.ant-modal-body）。找不到时退回传进来的节点，保持旧行为。
 */
export function nearestScrollableAncestor(node: HTMLElement | null): HTMLElement | null {
  let element: HTMLElement | null = node;
  while (element) {
    const style = window.getComputedStyle(element);
    const scrollable = style.overflowY === "auto" || style.overflowY === "scroll";
    if (scrollable && element.scrollHeight > element.clientHeight) return element;
    element = element.parentElement;
  }
  return node;
}

export interface UseResumeLivePreviewOptions {
  /** 制作台打开且中栏可见时为真；为假时一次请求都不发。 */
  enabled: boolean;
  /** 合并 overlay 之后的整份内容。 */
  content: ResumeDocument | null;
  layout?: ResumeLayout;
  /** 注入 `api/renderResume`：保留 `signal` 才能真的取消在飞请求。 */
  render: (content: ResumeDocument, layout: ResumeLayout, signal: AbortSignal) => Promise<string>;
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
  /** 闸门一：保存进行中（只由 `suspend()` / `resume()` 翻转）。 */
  const saveSuspendedRef = useRef(false);
  /** 闸门二：`enabled === false`（模式切到「精确」或制作台关闭）。见文件头「两个闸门」。 */
  const modePausedRef = useRef(false);
  const disposedRef = useRef(false);
  /** 首帧基线：内容引用 + 版式签名。 */
  const lastContentRef = useRef<ResumeDocument | null>(null);
  const lastLayoutRef = useRef<string | null>(null);
  /** 最近一次渲染的入参：`reconcile()` 用它判断"暂停期间内容是否变过"。 */
  const latestJobRef = useRef<{ content: ResumeDocument | null; layout?: ResumeLayout }>({
    content: null,
  });
  // 最新入参跟着渲染走：`reconcile()` 是命令式回调，读不到渲染作用域的 props。
  useEffect(() => {
    latestJobRef.current = { content, layout };
  }, [content, layout]);
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
    // 制作台传进来的 ref 是 flex 布局层（本身 overflow:hidden），真正滚的是弹窗正文；
    // 必须向上找到真正的滚动容器，否则每次刷新都只"恢复"一个永远为 0 的 scrollTop。
    const node = nearestScrollableAncestor(scrollRefOf.current?.current ?? null);
    const previousTop = node ? node.scrollTop : 0;
    const previousHeight = node ? node.scrollHeight : 0;
    htmlRef.current(html);
    if (!node) return;
    const restore = () => {
      const target = nearestScrollableAncestor(scrollRefOf.current?.current ?? null);
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
    // iframe 重排会把高度再撑一次并触发滚动锚定；分几拍再写回同一位置，末次写回赢。
    for (const delay of [120, 400, 1200]) window.setTimeout(restore, delay);
  }, []);

  const pump = useCallback(() => {
    // 两个闸门都要看：保存中不发（保存结果优先），模式暂停中也不发（这一栏不需要）。
    if (disposedRef.current || saveSuspendedRef.current || modePausedRef.current) return;
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
          if (!disposedRef.current && !saveSuspendedRef.current && !modePausedRef.current) {
            pumpRef.current();
          }
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
    // R-32：**挂起期间不记基线**。以前这里先写 `lastContentRef/lastLayoutRef` 再 return，
    // 保存期间隐藏/删除字段的改动被记成"已渲染过"，`resume()` 回来一比对就认为没变化，
    // 纸面于是停在旧一版（用户看到"隐藏了但纸面还在"）。基线只描述"真的排过的那一版"。
    // 模式暂停同理：精确模式期间改的内容要留给 `reconcile()` 判断。
    if (saveSuspendedRef.current || modePausedRef.current) return;
    lastContentRef.current = content;
    lastLayoutRef.current = signature;
    // 首帧只记基线：宿主刚渲染过同一份内容，再发一次只是让 iframe 白屏一下。
    if (first) return;
    schedule({ content, layout });
  }, [enabled, content, layout, schedule]);

  /**
   * 收尾：取消在飞请求、清 timer / pending、状态归 `idle`。
   *
   * 只做"动作"，不碰两个闸门——闸门由 `suspend()` / `resume()` / `enabled` effect 各自翻转，
   * 这样"保存中切模式"这类交叉场景不会把对方的闸门顺手关掉或打开（本批问题 12 的成因）。
   */
  const pause = useCallback(() => {
    clearTimer();
    pendingRef.current = null;
    seqRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    inflightRef.current = false;
    setState("idle");
  }, [clearTimer]);

  /**
   * 保存开始：关"保存闸门"并收尾。
   *
   * 单独成一个动作而不是"再判断一次 enabled"：保存成功后宿主会把 html 换成权威版本，
   * 此时任何在飞的实时结果都必然是旧的（见文件头第 8 条）。
   */
  const suspend = useCallback(() => {
    saveSuspendedRef.current = true;
    pause();
  }, [pause]);

  /**
   * 比对"最新入参"与"真的排过的那一版"，不一致就补排一次。
   *
   * R-32：暂停期间的内容变化没有记基线（见上面那条 effect），所以恢复时必须**主动比一次**——
   * 否则"保存期间改内容"永远等不到下一次 effect（依赖没变），纸面就一直是旧一版。
   * 补排程走 `schedule`（同一套 budget/rearm），不直接 `pump()`：恢复刚结束就撞上一次渲染，
   * `pump` 会绕过防抖把还没敲完的字也排进去。
   *
   * **保存闸门还关着就直接返回**：否则它会抢在保存结果前面把实时 html 推上屏。
   */
  const reconcile = useCallback(() => {
    if (disposedRef.current || saveSuspendedRef.current) return;
    const latest = latestJobRef.current;
    if (!latest.content || !latest.layout) return;
    const signature = JSON.stringify(latest.layout);
    if (lastContentRef.current === latest.content && lastLayoutRef.current === signature) return;
    lastContentRef.current = latest.content;
    lastLayoutRef.current = signature;
    schedule({ content: latest.content, layout: latest.layout });
  }, [schedule]);

  /** 保存结束：打开"保存闸门"并补排暂停期间的变化。 */
  const resume = useCallback(() => {
    saveSuspendedRef.current = false;
    reconcile();
  }, [reconcile]);

  // ── 精确模式 / 关闭：关"模式闸门"，切回时由 `reconcile()` 补排 ──────────
  useEffect(() => {
    if (!enabled) {
      // `enabled` 转假 = 这一栏不再需要实时结果（切到「精确」或制作台关闭）。
      // 与"保存开始"共用收尾动作，但**各关各的闸门**：这里绝不能碰 `saveSuspendedRef`，
      // 否则保存还没回来就切模式，实时渲染会立刻抢跑。
      modePausedRef.current = true;
      // pause 里的 setState("idle") 是对"结果已失效"的确定性收尾：enabled 翻转不
      // 频繁，且此刻 inflight 已被 abort 清空，不存在同帧级联渲染（规则豁免同
      // GenerateResumeModal 的收尾扇出写法）。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      pause();
      return;
    }
    // 只有"暂停 → 恢复"这一跳才补排。首次挂载时 `wasPaused` 是假：宿主刚渲染过同一份
    // 内容，补排只会多一次全量渲染（见文件头「为什么首帧不触发」）。
    const wasPaused = modePausedRef.current;
    modePausedRef.current = false;
    if (wasPaused) reconcile();
  }, [enabled, pause, reconcile]);

  useEffect(() => {
    /**
     * **挂载（再挂载）时把闸门复位**。
     *
     * `disposedRef` 描述的是"这一次挂载还活着吗"，所以它必须由 setup 归零：只在 cleanup 里
     * 置真、setup 里不管，第一次 cleanup 之后它就**永远**是真。而 cleanup 不只发生在"真卸载、
     * ref 跟着销毁"那条路上——React 的 StrictMode 会把每个 effect「挂载 → 清理 → 再挂载」
     * 跑一遍，这一轮里 **ref 是被复用的**，于是第二次挂载起来时闸门已经关着，而这次挂载才是
     * 真正在用的那一次。
     *
     * 漏了这一句的症状正是本批缺陷的原形：`pump` 第一道门就 `return`，于是
     * 「内容变了 → state=typing → 定时器到点 → pump 直接退出」——状态条永久停在
     * 「预览更新中…」，`render` 一次都不发，直到用户点保存（那条 html 走宿主，不经过本 hook）。
     */
    disposedRef.current = false;
    return () => {
      // 卸载后一律不再 setState：`disposedRef` 是唯一的闸门。
      disposedRef.current = true;
      clearTimer();
      pendingRef.current = null;
      seqRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [clearTimer]);
  useEffect(() => {
    stateCbRef.current?.(state);
  }, [state]);

  const retry = useCallback(() => {
    // 两个闸门任一关着都不重试：保存中重试会盖掉保存结果，模式暂停中重试没必要。
    if (saveSuspendedRef.current || modePausedRef.current || !enabled) return;
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
