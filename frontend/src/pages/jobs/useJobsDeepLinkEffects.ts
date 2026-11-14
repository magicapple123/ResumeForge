// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位广场的完成通知深链：两条「点通知里的查看」链接到达时的接续处理。
 *
 * - `?match_batch=history`：打开匹配度分析记录后清掉参数，刷新/返回不会再弹；
 * - `?job_id=<id>&analysis=1`：等详情拉全之后自动打开解读弹窗，再把参数清掉。
 *
 * URL → state 的镜像同步属"派生事件"，规则按书面理由豁免（与 useJobsPageState 同模式）。
 *
 * 从 JobsPage 拆出（行数预算）：本 hook 只做这两条深链的「到达即消费」，筛选与详情的
 * 常规 URL 状态化仍在 `useJobsPageState` 里。
 */
import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useSearchParams } from "react-router-dom";
import type { Job } from "../../types";

interface Options {
  /** 当前详情（getJob 的全量那份）；为 null 时 analysis 深链先等等。 */
  detailJob: Job | null;
  setMatchBatchView: Dispatch<SetStateAction<"setup" | "history">>;
  setMatchBatchOpen: Dispatch<SetStateAction<boolean>>;
  setAnalysisJob: Dispatch<SetStateAction<Job | null>>;
}

export function useJobsDeepLinkEffects({
  detailJob,
  setMatchBatchView,
  setMatchBatchOpen,
  setAnalysisJob,
}: Options): void {
  const [searchParams, setSearchParams] = useSearchParams();

  // 完成通知的「查看结果」深链（/jobs?match_batch=history）：打开分析记录后清掉参数，
  // 让刷新/返回不会再弹。useJobsPageState 管它自己的筛选参数，这里只动 match_batch。
  // deps 里的 setState 函数由 React 保证引用稳定，列进来只是让 exhaustive-deps 通过。
  useEffect(() => {
    if (searchParams.get("match_batch") !== "history") return;
    setMatchBatchView("history");
    setMatchBatchOpen(true);
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("match_batch");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams, setMatchBatchOpen, setMatchBatchView]);

  // 完成通知的「查看」深链（/jobs?job_id=<id>&analysis=1）：等详情拉全之后自动打开解读弹窗，
  // 再把参数清掉。boolean 锁存保证"清参数触发的这一轮"不会再把弹窗重开一次；参数彻底
  // 消失后复位，这样从任务条再点一次「查看」（同一个岗位）仍然能打开。
  const analysisLinkHandled = useRef(false);
  useEffect(() => {
    if (searchParams.get("analysis") !== "1") {
      analysisLinkHandled.current = false;
      return;
    }
    if (!detailJob || analysisLinkHandled.current) return;
    analysisLinkHandled.current = true;
    setAnalysisJob(detailJob);
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("analysis");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, detailJob, setSearchParams, setAnalysisJob]);
}
