// SPDX-License-Identifier: Apache-2.0
/** 面试复盘（R-11 补）：录入真实被问问题 → 分析答题思路 → 反向优化简历。
 *
 * 复用已就绪的 analyzeInterviewQuestion / optimizeResumeFromInterview 接口，不另造。反向优化只产出
 * 建议列表、不改正文。分析出思路后**自动保存**为历史（无需手点保存），也保留「保存复盘」按钮。
 *
 * 历史记录富还原：传入 record 后用与刚生成时相同的渲染路径展示，「反向优化简历」按钮可点、生成结果
 * 写回同一条记录。旧版纯文本记录（analysis 为字符串）仅做兼容展示并提示"仅可查看"。
 */
import { SaveOutlined, SendOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Input, Select, Space, Typography } from "antd";
import EmptyState from "./common/EmptyState";
import { useEffect, useState } from "react";
import {
  analyzeInterviewQuestion,
  deleteReview,
  listReviews,
  optimizeResumeFromInterview,
  saveReview,
  updateReview,
} from "../api/interview";
import ReviewHistoryCard from "./interview/ReviewHistoryCard";
import SuggestionsCard from "./interview/SuggestionsCard";
import { useApi } from "../hooks/useApi";
import { useJobSearchSelect, useResumeSearchSelect } from "../hooks/remoteSearchOptions";
import type { InterviewAnalysis, InterviewOptimizeResult, InterviewReviewRecord } from "../types";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

interface Props {
  onGoToResume?: () => void;
  /** 历史记录富还原：传入一条已保存的复盘记录后，用相同的渲染路径展示并允许「反向优化简历」回写。 */
  record?: InterviewReviewRecord | null;
  /** 点击历史条目里的「查看详情」时回调，由父组件接管选中。 */
  onOpenRecord?: (record: InterviewReviewRecord) => void;
  /** 退出历史查看时回调。 */
  onCloseRecord?: () => void;
}

export default function InterviewReviewPanel({
  onGoToResume,
  record,
  onOpenRecord,
  onCloseRecord,
}: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const { message } = App.useApp();
  // 岗位 / 简历下拉改为远程搜索（P0-1）：不再由页面预拉"前 100 条"当全量。
  const jobSelect = useJobSearchSelect();
  const resumeSelect = useResumeSearchSelect();
  // 下拉常驻可见（未进入历史视图时）：挂载即预拉第一页候选。
  useEffect(() => {
    void jobSelect.reload();
    void resumeSelect.reload();
    // hook 的回调引用稳定，只在挂载时执行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [question, setQuestion] = useState("");
  const [jobId, setJobId] = useState<number | undefined>();
  const [resumeId, setResumeId] = useState<number | undefined>();
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<InterviewAnalysis | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<InterviewOptimizeResult | null>(null);
  const [saving, setSaving] = useState(false);
  const reviews = useApi(listReviews, []);

  // 历史富还原：用历史记录的 analysis/suggestions 充当展示数据。
  // 旧版纯文本记录（analysis 为字符串）不是结构化对象，不能当 analysis 用，置空以免渲染时崩。
  const viewAnalysis: InterviewAnalysis | null = record
    ? typeof record.analysis === "string"
      ? null
      : (record.analysis as InterviewAnalysis)
    : analysis;
  // 建议展示：刚生成的 optimizeResult 优先（含记录模式下反向优化新产出的建议），否则回退历史记录里已持久化的建议。
  const viewSuggestions: InterviewOptimizeResult["suggestions"] = optimizeResult?.suggestions
    ? optimizeResult.suggestions
    : record
      ? (record.suggestions as InterviewOptimizeResult["suggestions"])
      : [];

  // 旧版纯文本记录（analysis 为字符串）兼容：只展示提示，不崩。
  const legacyText = record && typeof record.analysis === "string" ? record.analysis : null;

  // 打开历史记录时，用其中持久化的分析与建议填充展示状态（不重新调用模型），并预填关联的岗位/简历。
  // Compiler 规范：随 record 变化的回填用渲染期守卫式调整（哨兵 null 覆盖挂载场景）。
  const [prevRecord, setPrevRecord] = useState<InterviewReviewRecord | null | undefined>(record);
  if (prevRecord !== record) {
    setPrevRecord(record);
    if (record) {
      setAnalysis((record.analysis as InterviewAnalysis) ?? null);
      setOptimizeResult(
        record.suggestions && record.suggestions.length
          ? {
              resume_id: record.resume_id ?? 0,
              suggestions: record.suggestions,
              llm_used: true,
              notes: [],
            }
          : null,
      );
      if (record.job_id) setJobId(record.job_id);
      if (record.resume_id) setResumeId(record.resume_id);
    }
  }

  // 历史富还原的已选值保显示（P0-1）：记录里的岗位/简历往往不在第一页候选里，按 id 回查补进候选。
  useEffect(() => {
    if (!record) return;
    void jobSelect.ensure(record.job_id);
    void resumeSelect.ensure(record.resume_id);
    // hook 的回调引用稳定，只跟随历史记录变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record]);

  const analyze = async () => {
    if (!record && !question.trim()) {
      message.error(t("interviewReview.error.needQuestion"));
      return;
    }
    setAnalyzing(true);
    try {
      const result = await analyzeInterviewQuestion({
        question: (record?.questions?.[0] ?? question).trim(),
        job_id: jobId ?? null,
        resume_id: resumeId ?? null,
      });
      setAnalysis(result);
      setOptimizeResult(null);
      // 分析出思路后自动保存为历史（无需用户手点保存）。
      await persistReview(result, []);
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("interviewReview.error.analyzeFailed"),
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const persistReview = async (
    analysisObj: InterviewAnalysis,
    suggestions: InterviewOptimizeResult["suggestions"],
  ) => {
    setSaving(true);
    try {
      await saveReview({
        job_id: jobId ?? null,
        job_title: jobSelect.options.find((option) => option.value === jobId)?.label ?? "",
        company: "",
        resume_id: resumeId ?? null,
        resume_title: resumeSelect.options.find((option) => option.value === resumeId)?.label ?? "",
        questions: analysisObj.question ? [analysisObj.question] : [],
        analysis: analysisObj,
        suggestions: suggestions ?? [],
        model: "",
      });
      await reviews.reload();
    } catch (error) {
      message.warning(
        error instanceof Error ? error.message : t("interviewReview.error.autoSaveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const saveReviewRecord = async () => {
    if (!analysis || saving) return;
    await persistReview(analysis, optimizeResult?.suggestions ?? []);
  };

  const optimize = async () => {
    if (!resumeId) {
      message.error(t("interviewReview.error.needResume"));
      return;
    }
    if (!viewAnalysis) {
      message.error(t("interviewReview.error.needAnalysis"));
      return;
    }
    setOptimizing(true);
    try {
      const result = await optimizeResumeFromInterview({
        resume_id: resumeId,
        job_id: jobId ?? null,
        weaknesses: viewAnalysis.pitfalls,
        follow_ups: viewAnalysis.follow_up,
      });
      setOptimizeResult(result);
      // 历史记录富还原：把新生成的建议写回同一条记录。
      if (record) {
        try {
          await updateReview(record.id, {
            analysis: viewAnalysis,
            suggestions: result.suggestions,
          });
        } catch (error) {
          message.warning(
            error instanceof Error ? error.message : t("interviewReview.error.writeBackFailed"),
          );
        }
      }
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("interviewReview.error.optimizeFailed"),
      );
    } finally {
      setOptimizing(false);
    }
  };

  const removeReview = async (id: number) => {
    try {
      await deleteReview(id);
      message.success(t("interviewReview.deleted"));
      await reviews.reload();
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("interviewReview.error.deleteFailed"),
      );
    }
  };

  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="middle">
      {record && (
        <Alert
          type="info"
          showIcon
          title={t("interviewReview.alert.viewing", {
            id: record.id,
            // 格式化逻辑留在代码里：`{time}` 只接格式化后的结果。
            time: record.created_at.replace("T", " ").slice(0, 16),
          })}
          action={
            onCloseRecord && (
              <Button size="small" onClick={onCloseRecord}>
                {t("common.action.back")}
              </Button>
            )
          }
        />
      )}

      {!record && (
        <Card size="small" title={t("interviewReview.card.setup")}>
          <Space orientation="vertical" style={{ width: "100%" }} size={8}>
            <Input.TextArea
              value={question}
              autoSize={{ minRows: 2, maxRows: 4 }}
              placeholder={t("interviewReview.placeholder.question")}
              onChange={(event) => setQuestion(event.target.value)}
            />
            <Space wrap>
              <Select
                allowClear
                style={{ minWidth: 220 }}
                placeholder={t("interviewReview.placeholder.job")}
                value={jobId}
                onChange={setJobId}
                {...jobSelect.selectProps}
              />
              <Select
                allowClear
                style={{ minWidth: 220 }}
                placeholder={t("interviewReview.placeholder.resume")}
                value={resumeId}
                onChange={setResumeId}
                {...resumeSelect.selectProps}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={analyzing}
                onClick={() => void analyze()}
              >
                {t("interviewReview.action.analyze")}
              </Button>
            </Space>
          </Space>
        </Card>
      )}

      {viewAnalysis ? (
        <Card size="small" title={t("interviewReview.card.analysis")}>
          <Typography.Paragraph strong>{viewAnalysis.framework}</Typography.Paragraph>
          {viewAnalysis.key_points.length > 0 && (
            <>
              <Typography.Text strong>{t("interviewReview.section.keyPoints")}</Typography.Text>
              <ul>
                {viewAnalysis.key_points.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
          {viewAnalysis.follow_up.length > 0 && (
            <>
              <Typography.Text strong>{t("interviewReview.section.followUp")}</Typography.Text>
              <ul>
                {viewAnalysis.follow_up.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
          {viewAnalysis.pitfalls.length > 0 && (
            <>
              <Typography.Text strong>{t("interviewReview.section.pitfalls")}</Typography.Text>
              <ul>
                {viewAnalysis.pitfalls.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
          <Space wrap style={{ marginTop: 12 }}>
            {record && (
              <Select
                allowClear
                style={{ minWidth: 220 }}
                placeholder={t("interviewReview.placeholder.resume")}
                value={resumeId}
                onChange={setResumeId}
                {...resumeSelect.selectProps}
              />
            )}
            <Button
              icon={<ThunderboltOutlined />}
              loading={optimizing}
              onClick={() => void optimize()}
            >
              {t("interviewReview.action.optimize")}
            </Button>
            {!record && (
              <Button
                icon={<SaveOutlined />}
                loading={saving}
                onClick={() => void saveReviewRecord()}
              >
                {t("interviewReview.action.save")}
              </Button>
            )}
            <Typography.Text type="secondary">{t("interviewReview.optimize.note")}</Typography.Text>
          </Space>
        </Card>
      ) : (
        !record && <EmptyState description={t("interviewReview.empty")} />
      )}

      {legacyText ? (
        <Card size="small" title={t("interviewReview.card.legacy")}>
          <Alert
            type="warning"
            showIcon
            title={t("interviewReview.legacy.title")}
            description={t("interviewReview.legacy.body")}
          />
          <Typography.Paragraph style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
            {legacyText}
          </Typography.Paragraph>
        </Card>
      ) : (
        viewSuggestions.length > 0 && (
          <SuggestionsCard suggestions={viewSuggestions} onGoToResume={onGoToResume} />
        )
      )}

      <ReviewHistoryCard
        reviews={reviews.data ?? null}
        loading={reviews.loading}
        error={reviews.error}
        onOpenRecord={onOpenRecord}
        onRemove={(id) => void removeReview(id)}
      />
    </Space>
  );
}
