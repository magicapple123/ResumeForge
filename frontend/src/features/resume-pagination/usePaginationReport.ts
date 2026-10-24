// SPDX-License-Identifier: Apache-2.0
/**
 * W08 分页报告的**取数编排**：手动触发、单飞、可取消、过时丢弃。
 *
 * 端点 `POST /api/resumes/{id}/pagination/report` 由 W08-BE 交付（task-12）；本 hook 先落地
 * 宿主侧接线，端点就绪后**只需把 `fetcher` 默认值换成真实实现**（现在默认就是真实的
 * `fetchPaginationReport`，后端未就绪时表现为 error，界面如实显示"获取失败"）。
 *
 * 三条约束与 W11 检查面板同源：
 * 1. 不自动重跑（分页报告要真排一遍版，用户主动点才发）；
 * 2. 同一时刻只发一个（连点"获取报告"不会排队）；
 * 3. 换代（换简历/换参数）时掐掉在飞请求并清空旧报告，避免旧结论混进新版面。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { isCancellation } from "../../api/client";
import {
  fetchPaginationReport,
  type PaginationReport,
  type PaginationReportRequest,
} from "./paginationReport";

export type PaginationReportStatus = "idle" | "loading" | "error" | "ready";

export interface UsePaginationReportArgs {
  /** 当前简历 id；null = 没有可测量的记录（按钮禁用/不请求）。 */
  resumeId?: number | null;
  /** 构造请求体（版式快照 + 可选未保存正文）；返回 null = 当前上下文不能测量。 */
  buildRequest: () => PaginationReportRequest | null;
  /** 测试可注入；默认走真实端点。 */
  fetcher?: typeof fetchPaginationReport;
}

export interface UsePaginationReportResult {
  status: PaginationReportStatus;
  report: PaginationReport | null;
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
}: UsePaginationReportArgs): UsePaginationReportResult {
  const [status, setStatus] = useState<PaginationReportStatus>("idle");
  const [report, setReport] = useState<PaginationReport | null>(null);
  const [error, setError] = useState("");
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStatus((prev) => (prev === "loading" ? "idle" : prev));
  }, []);

  const clear = useCallback(() => {
    cancel();
    setReport(null);
    setError("");
    setStatus("idle");
  }, [cancel]);

  // 换简历 = 旧报告不再属于当前文档：清空，不把上一份的页数留在界面上。
  const [prevResumeId, setPrevResumeId] = useState(resumeId);
  if (prevResumeId !== resumeId) {
    setPrevResumeId(resumeId);
    setReport(null);
    setError("");
    setStatus("idle");
  }

  const run = useCallback(async () => {
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
  }, [buildRequest, fetcher, resumeId]);

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
    error,
    loading: status === "loading",
    run,
    cancel,
    clear,
  };
}
