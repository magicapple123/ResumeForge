// SPDX-License-Identifier: Apache-2.0
/**
 * 统一检查的请求编排（W11 / P0-04）：**手动触发、单飞、可取消、过时丢弃**。
 *
 * 三条硬约束（契约 §4.6 + 测试策略）：
 * 1. 内容/版式变化后**不自动重跑**（用户可能正在打字）；面板据 `stale` 显示"结果基于上一版"；
 * 2. 同一时刻只发一个请求；连点"检查"不会排队 N 次；
 * 3. 回包快照与当前草稿不一致 → 丢弃（不把旧版本的结论混进当前版本的页面）。
 *
 * 22a：结果的初值来自 `preflightCache`（模块级、最多 3 份），所以退出制作台再回来能
 * 直接看到上次的清单。缓存只跨**页面**，不跨会话（F5 仍是空态），也不跨数据集
 * （`datasetScope` 不一致时读不到）。
 *
 * 本 hook 不阻塞保存/导出：它只发一次独立请求，失败只影响面板自己的错误态。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isCancellation } from "../../../api/client";
import { currentDatasetScope } from "../../../api/datasetScope";
import { t } from "../../../i18n";
import type { PreflightOut, PreflightRequest } from "./types";
import { runPreflight } from "./preflightApi";
import { clearPreflightCache, readPreflightEntry, writePreflightCache } from "./preflightCache";

export type PreflightStatus = "idle" | "loading" | "error" | "ready";

export interface UsePreflightOptions {
  resumeId?: number | null;
  /**
   * 当前草稿的**客户端指纹**（内容签名 + 版式关键参数）；null = 暂时没有可检查的文档。
   *
   * 为什么不是后端的 sha256：后端哈希只有拿到响应才知道，不能拿来判断"发请求之后草稿有没有变"。
   * 契约 §4.6 要求的是"发起时记下 snapshotKey，回包不匹配就丢弃"——这里用客户端能算的稳定键，
   * 响应里的 `snapshot` 仍原样透出（面板展示"检查版本"）。
   *
   * 它同时也是缓存的版本戳：读缓存**不**拿它做拒绝条件，恢复后再用它算 `stale`。
   */
  currentKey: string | null;
  /** 构造请求体；返回 null = 当前上下文不能检查（例如只读宿主）。 */
  buildRequest: () => PreflightRequest | null;
  /** 测试可注入；默认走真实 API。 */
  fetcher?: typeof runPreflight;
  /** 防抖窗口；契约要求 ≥400ms（连点/修复后复检避免连发）。 */
  debounceMs?: number;
}

export interface UsePreflightResult {
  status: PreflightStatus;
  result: PreflightOut | null;
  error: string;
  /** 结果基于上一版（快照不同）→ 面板顶部提示"点检查更新"。 */
  stale: boolean;
  /** 有在飞请求（按钮 loading）。 */
  running: boolean;
  run: () => Promise<void>;
  /** 防抖后再跑（修复入口触发复检用）。 */
  schedule: () => void;
  cancel: () => void;
  /** 清空结果**并清掉缓存**（明确丢弃这份结论时用；关闭弹窗不算——那是 22a 要保留的）。 */
  clear: () => void;
}

const MIN_DEBOUNCE_MS = 400;

export function usePreflight({
  resumeId,
  currentKey,
  buildRequest,
  fetcher = runPreflight,
  debounceMs = MIN_DEBOUNCE_MS,
}: UsePreflightOptions): UsePreflightResult {
  /**
   * 初值：同 `resumeId`（+ 同一数据集）的上一份结果。`status` / `result` / `resultKey`
   * 三者必须一起恢复——只恢复 `result` 会让 `stale` 恒为 true，只恢复 `status` 会白屏。
   * 只读一次（挂载时），之后靠 `clear` / `run` 维护。
   */
  const [restored] = useState(() =>
    resumeId == null ? null : readPreflightEntry(resumeId, currentDatasetScope()),
  );
  const [status, setStatus] = useState<PreflightStatus>(restored ? "ready" : "idle");
  const [result, setResult] = useState<PreflightOut | null>(restored?.result ?? null);
  const [error, setError] = useState("");
  /** 当前结果对应的客户端请求键（`null` = 还没有结果）。 */
  const [resultKey, setResultKey] = useState<string | null>(restored?.key ?? null);
  const tokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 回调里读的是"最新一次渲染"的请求键/请求体，不跟着每次渲染重造回调。 */
  const currentKeyRef = useRef<string | null>(currentKey);
  const buildRequestRef = useRef(buildRequest);
  const fetcherRef = useRef(fetcher);
  /** 当前结果属于哪份简历（换简历时据此丢掉别人的清单）。 */
  const resumeIdRef = useRef<number | null>(resumeId ?? null);

  useEffect(() => {
    currentKeyRef.current = currentKey;
  }, [currentKey]);

  useEffect(() => {
    buildRequestRef.current = buildRequest;
    fetcherRef.current = fetcher;
  }, [buildRequest, fetcher]);

  const clearDebounce = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const run = useCallback(async () => {
    if (resumeId == null || inFlightRef.current) return;
    const requestKey = currentKeyRef.current;
    const body = buildRequestRef.current();
    if (!body || requestKey === null) return;
    clearDebounce();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    inFlightRef.current = true;
    const token = tokenRef.current + 1;
    tokenRef.current = token;
    setStatus("loading");
    setError("");
    try {
      const next = await fetcherRef.current(resumeId, body, controller.signal);
      if (token !== tokenRef.current) return; // 被取消 / 被更新的请求取代
      if (requestKey !== currentKeyRef.current) {
        // 请求发出之后草稿又变了：这份结论属于旧版本，直接丢弃。
        setStatus((previous) => (previous === "loading" ? "idle" : previous));
        return;
      }
      setResult(next);
      setResultKey(requestKey);
      setStatus("ready");
      // 跨页面保留：下次挂载直接从这里恢复（数据集身份一起存，切库后读不到）。
      writePreflightCache({
        resumeId,
        key: requestKey,
        datasetScope: currentDatasetScope(),
        result: next,
      });
    } catch (caught) {
      if (token !== tokenRef.current) return;
      if (isCancellation(caught)) {
        setStatus((previous) => (previous === "loading" ? "idle" : previous));
        return;
      }
      setError(
        caught instanceof Error && caught.message ? caught.message : t("preflight.error.generic"),
      );
      setStatus("error");
    } finally {
      if (token === tokenRef.current) inFlightRef.current = false;
    }
  }, [clearDebounce, resumeId]);

  const schedule = useCallback(() => {
    clearDebounce();
    const wait = Math.max(MIN_DEBOUNCE_MS, debounceMs);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void run();
    }, wait);
  }, [clearDebounce, debounceMs, run]);

  const cancel = useCallback(() => {
    clearDebounce();
    tokenRef.current += 1;
    inFlightRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus((previous) => (previous === "loading" ? "idle" : previous));
  }, [clearDebounce]);

  const clear = useCallback(() => {
    cancel();
    setResult(null);
    setResultKey(null);
    setError("");
    setStatus("idle");
    // 缓存与内存里的结果同寿命：显式清空就是"这份结果不要了"。
    clearPreflightCache(resumeId ?? undefined);
  }, [cancel, resumeId]);

  /**
   * 换了一份简历（同一个钩子实例收到新的 `resumeId`）：内存里那份属于上一份简历的清单
   * 必须立刻换掉，不能被当成"当前简历的检查结果"。缓存里有就恢复，没有就回到空态。
   */
  useEffect(() => {
    if (resumeId == null || resumeIdRef.current === resumeId) return;
    resumeIdRef.current = resumeId;
    cancel();
    const restoredEntry = readPreflightEntry(resumeId, currentDatasetScope());
    setResult(restoredEntry?.result ?? null);
    setResultKey(restoredEntry?.key ?? null);
    setError("");
    setStatus(restoredEntry ? "ready" : "idle");
  }, [cancel, resumeId]);

  // 卸载：中止在飞请求、清防抖，避免回包写进已卸载组件。
  useEffect(
    () => () => {
      tokenRef.current += 1;
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  // 结果是否属于当前版本：客户端请求键在渲染期纯比较（不另存需要同步的 state）。
  const stale = useMemo(
    () => result !== null && resultKey !== currentKey,
    [currentKey, result, resultKey],
  );

  return {
    status,
    result,
    error,
    stale,
    running: status === "loading",
    run,
    schedule,
    cancel,
    clear,
  };
}
