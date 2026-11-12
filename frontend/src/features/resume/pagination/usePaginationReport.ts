// SPDX-License-Identifier: Apache-2.0
/**
 * W08 分页报告的**取数编排**：手动触发、单飞、可取消、过时丢弃。
 *
 * 端点 `POST /api/resumes/{id}/pagination/report` 由 W08-BE 交付（task-12）；本 hook 先落地
 * 宿主侧接线，端点就绪后**只需把 `fetcher` 默认值换成真实实现**（现在默认就是真实的
 * `fetchPaginationReport`，后端未就绪时表现为 error，界面如实显示"获取失败"）。
 *
 * 三条约束与 W11 检查面板同源：
 * 1. 默认不自动重跑（分页报告要真排一遍版，用户主动点才发）；
 * 2. 同一时刻只发一个（连点"获取报告"不会排队）；
 * 3. 换代（换简历/换参数）时掐掉在飞请求并清空旧报告，避免旧结论混进新版面。
 *
 * ## `auto`：画布页数要的"跟着内容自己跑一次"（2026-11-02，问题 3）
 *
 * 草稿画布的页数改由服务端报告决定，所以它必须**自己**取数，不能等用户点按钮。传
 * `auto.signature`（内容 + 版式的指纹）即可：
 *
 * - 同一指纹只跑一次（600ms 合并窗口，与 `useResumeLivePreview` 的防抖同值）；
 * - 新指纹会掐掉在飞的旧请求再跑（与手动的"单飞"不同：手动画布上那次请求已经过期了）；
 * - 失败就是失败，**不重试**——画布按"拿不到报告"退回浏览器测量（单向降级）。
 *
 * 手动模式（不传 `auto`）的行为与之前逐字相同。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { isCancellation } from "../../../api/client";
import {
  fetchPaginationReport,
  type PaginationReport,
  type PaginationReportRequest,
} from "./paginationReport";

export type PaginationReportStatus = "idle" | "loading" | "error" | "ready";

/** 自动取数的合并窗口：与草稿实时预览（`DEFAULT_DEBOUNCE_MS`）取同一个值。 */
const AUTO_DELAY_MS = 600;

/** 自动取数：给出"这份报告对应哪一版内容"的指纹，hook 自己在指纹变化时跑一次。 */
export interface AutoPaginationOptions {
  /** 内容 + 版式指纹；变了就重新取，同一个值只取一次。 */
  signature: string;
  /** 合并窗口（ms），默认 600。 */
  delayMs?: number;
}

export interface UsePaginationReportArgs {
  /** 当前简历 id；null = 没有可测量的记录（按钮禁用/不请求）。 */
  resumeId?: number | null;
  /** 构造请求体（版式快照 + 可选未保存正文）；返回 null = 当前上下文不能测量。 */
  buildRequest: () => PaginationReportRequest | null;
  /** 测试可注入；默认走真实端点。 */
  fetcher?: typeof fetchPaginationReport;
  /** 自动取数（画布页数用它）；不传 = 只能手动 `run()`。 */
  auto?: AutoPaginationOptions | null;
}

export interface UsePaginationReportResult {
  status: PaginationReportStatus;
  report: PaginationReport | null;
  /** `report` 是哪一版内容算出来的（自动取数时是那次请求的签名；手动为空串）。 */
  reportSignature: string;
  error: string;
  loading: boolean;
  run: () => Promise<void>;
  cancel: () => void;
  clear: () => void;
}

export function usePaginationReport({
  resumeId,
  buildRequest,
  fetcher = fetchPaginationReport,
  auto = null,
}: UsePaginationReportArgs): UsePaginationReportResult {
  const [status, setStatus] = useState<PaginationReportStatus>("idle");
  const [report, setReport] = useState<PaginationReport | null>(null);
  const [reportSignature, setReportSignature] = useState("");
  const [error, setError] = useState("");
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  /** 已经派出去过的自动签名：同一份内容只请求一次（失败也不重试，见文件头）。 */
  const dispatchedRef = useRef("");

  const cancel = useCallback(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStatus((prev) => (prev === "loading" ? "idle" : prev));
  }, []);

  const clear = useCallback(() => {
    cancel();
    setReport(null);
    setReportSignature("");
    setError("");
    setStatus("idle");
  }, [cancel]);

  // 换简历 = 旧报告不再属于当前文档：清空，不把上一份的页数留在界面上。
  const [prevResumeId, setPrevResumeId] = useState(resumeId);
  if (prevResumeId !== resumeId) {
    setPrevResumeId(resumeId);
    setReport(null);
    setReportSignature("");
    setError("");
    setStatus("idle");
  }

  const runReport = useCallback(
    async (signature: string) => {
      const request = buildRequest();
      if (resumeId == null || request === null) return;
      if (controllerRef.current) return; // 单飞：在飞时再点不排队（按钮本身也 loading）。
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      const controller = new AbortController();
      controllerRef.current = controller;
      setStatus("loading");
      setError("");
      try {
        const next = await fetcher(resumeId, request, controller.signal);
        if (generationRef.current !== generation) return;
        setReport(next);
        setReportSignature(signature);
        setStatus("ready");
      } catch (caught) {
        if (generationRef.current !== generation) return;
        if (controller.signal.aborted || isCancellation(caught)) {
          setStatus("idle");
          return;
        }
        setError(caught instanceof Error ? caught.message : "");
        setStatus("error");
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [buildRequest, fetcher, resumeId],
  );

  /** 手动取数（宿主点「获取分页报告」）：签名留空，表示"不是自动口径算出来的"。 */
  const run = useCallback(() => runReport(""), [runReport]);

  // 自动取数：只依赖签名与窗口这两个**原始值**，避免每次渲染都重置计时器。
  const autoEnabled = Boolean(auto) && resumeId != null;
  const autoSignature = auto?.signature ?? "";
  const autoDelayMs = auto?.delayMs ?? AUTO_DELAY_MS;
  useEffect(() => {
    if (!autoEnabled || !autoSignature) return undefined;
    if (dispatchedRef.current === autoSignature) return undefined;
    const timer = setTimeout(() => {
      dispatchedRef.current = autoSignature;
      // 新签名作废旧请求：手动那条链路要保持"单飞"，自动这条必须换代——
      // 否则内容改了之后这一次请求会被在飞的旧请求挡掉，页数停在上一版。
      controllerRef.current?.abort();
      controllerRef.current = null;
      void runReport(autoSignature);
    }, autoDelayMs);
    return () => clearTimeout(timer);
  }, [autoDelayMs, autoEnabled, autoSignature, runReport]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      controllerRef.current?.abort();
    },
    [],
  );

  return {
    status,
    report,
    reportSignature,
    error,
    loading: status === "loading",
    run,
    cancel,
    clear,
  };
}
