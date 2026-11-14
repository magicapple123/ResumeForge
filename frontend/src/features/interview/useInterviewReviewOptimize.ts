// SPDX-License-Identifier: Apache-2.0
/** 面试复盘的「反向优化简历」与历史删除动作（从 InterviewReviewPanel 拆出，压 500 行预算）。
 *
 * 纯动作层：调 optimize / updateReview / deleteReview 接口、把结果写回正确作用域
 * （记录态 vs 工作态）、给用户可读的失败提示。展示与状态本体仍在面板里。
 */
import { App } from "antd";
import type { Dispatch, SetStateAction } from "react";
import { deleteReview, optimizeResumeFromInterview, updateReview } from "../../api/interview";
import { errorText, useAbortableRequest } from "../../hooks/useAbortableRequest";
import type {
  InterviewAnalysis,
  InterviewOptimizeResult,
  InterviewReviewRecord,
} from "../../types";
import { t } from "../../i18n";

type MessageApi = ReturnType<typeof App.useApp>["message"];

interface Options {
  record: InterviewReviewRecord | null | undefined;
  viewAnalysis: InterviewAnalysis | null;
  /** 后端 `MAX_OPTIMIZE_ITEMS = 20` 截断后的提交值。 */
  effectiveWeaknesses: string[];
  effectiveFollowUps: string[];
  /** 可点条件 = 后端的 `require_some_input`（两组都空时按钮禁用）。 */
  canOptimize: boolean;
  hasResume: boolean;
  internalResumeId: number | null;
  activeJobId: number | null | undefined;
  /** 外部简历/导入文件的正文载荷；内部简历为空对象（后端从记录里读）。 */
  materialPayload: { resume_text?: string; resume_title?: string };
  /** 工作态自动保存拿到的记录 id（反向优化写回它）。 */
  workRecordId: number | null;
  message: MessageApi;
  reloadReviews: () => Promise<unknown>;
  setOptimizeResult: Dispatch<SetStateAction<InterviewOptimizeResult | null>>;
  setRecordOptimizeResult: Dispatch<SetStateAction<InterviewOptimizeResult | null>>;
}

export function useInterviewReviewOptimize({
  record,
  viewAnalysis,
  effectiveWeaknesses,
  effectiveFollowUps,
  canOptimize,
  hasResume,
  internalResumeId,
  activeJobId,
  materialPayload,
  workRecordId,
  message,
  reloadReviews,
  setOptimizeResult,
  setRecordOptimizeResult,
}: Options) {
  // 双向优化是一「点一下等十几秒」的生成：可停，不影响分析请求。
  const optimizeRequest = useAbortableRequest();
  const optimizing = optimizeRequest.loading;

  const optimize = async () => {
    if (!hasResume) {
      message.error(t("interviewReview.error.needResume"));
      return;
    }
    if (!viewAnalysis) {
      message.error(t("interviewReview.error.needAnalysis"));
      return;
    }
    // 兜底：按钮已禁用，但键盘/程序化触发仍可能走到这里；发请求必然 422。
    if (!canOptimize) {
      message.error(t("interviewReview.optimize.needInput"));
      return;
    }
    const outcome = await optimizeRequest.run((signal) =>
      optimizeResumeFromInterview(
        {
          resume_id: internalResumeId,
          job_id: activeJobId ?? null,
          weaknesses: effectiveWeaknesses,
          follow_ups: effectiveFollowUps,
          ...materialPayload,
        },
        signal,
      ),
    );
    if (outcome.status === "error") {
      message.error(errorText(outcome.error, t("interviewReview.error.optimizeFailed")));
      return;
    }
    if (outcome.status === "aborted") return;
    // 记录态：结果只落记录作用域，并 PATCH 这一条。
    if (record) {
      setRecordOptimizeResult(outcome.data);
      try {
        await updateReview(record.id, {
          analysis: {
            ...viewAnalysis,
            pitfalls: effectiveWeaknesses,
            follow_up: effectiveFollowUps,
          },
          suggestions: outcome.data.suggestions,
        });
      } catch (error) {
        message.warning(
          error instanceof Error ? error.message : t("interviewReview.error.writeBackFailed"),
        );
      }
      return;
    }
    setOptimizeResult(outcome.data);
    // F03：工作态也必须落库，否则刷新后建议数为 0。目标 id 来自自动保存；为空说明那次
    // 保存失败了——明确提示，不静默丢弃（用户还能点「保存复盘」重试）。
    if (workRecordId === null) {
      message.warning(t("interviewReview.error.notPersisted"));
      return;
    }
    try {
      await updateReview(workRecordId, {
        analysis: {
          ...viewAnalysis,
          pitfalls: effectiveWeaknesses,
          follow_up: effectiveFollowUps,
        },
        suggestions: outcome.data.suggestions,
      });
      await reloadReviews();
    } catch (error) {
      message.warning(
        error instanceof Error ? error.message : t("interviewReview.error.writeBackFailed"),
      );
    }
  };

  const removeReview = async (id: number) => {
    try {
      await deleteReview(id);
      message.success(t("interviewReview.deleted"));
      await reloadReviews();
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("interviewReview.error.deleteFailed"),
      );
    }
  };

  return {
    optimizing,
    optimize,
    cancelOptimize: optimizeRequest.cancel,
    removeReview,
  };
}
