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
import AbortButton from "./common/AbortButton";
import {
  normalizeOptimizeItems,
  normalizeReviewAnalysis,
  normalizeSuggestions,
  OPTIMIZE_ITEM_LIMIT,
  splitOptimizeLines,
} from "../features/interview/normalizeReview";
import { errorText, useAbortableRequest } from "../hooks/useAbortableRequest";
import { useApi } from "../hooks/useApi";
import { useJobSearchSelect, useResumeSearchSelect } from "../hooks/remoteSearchOptions";
import type { InterviewAnalysis, InterviewOptimizeResult, InterviewReviewRecord } from "../types";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import { formatServerTime } from "../utils/serverTime";

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
  // 分析思路与反向优化都是一次「点一下等十几秒」的生成：各自可停，互不影响。
  const analyzeRequest = useAbortableRequest();
  const optimizeRequest = useAbortableRequest();
  const analyzing = analyzeRequest.loading;
  const optimizing = optimizeRequest.loading;
  const [analysis, setAnalysis] = useState<InterviewAnalysis | null>(null);
  const [optimizeResult, setOptimizeResult] = useState<InterviewOptimizeResult | null>(null);
  // 反向优化的两个可编辑输入（问题 12）：`null` = 用户没改过 → 回落到模型分析值。
  // 不用「props 灌 state」：那会把编辑值混进 `viewAnalysis`（record.analysis 的派生只读视图）。
  const [weaknesses, setWeaknesses] = useState<string[] | null>(null);
  const [followUps, setFollowUps] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const reviews = useApi(listReviews, []);

  // 历史富还原：用历史记录的 analysis/suggestions 充当展示数据。
  // **必须过 normalizeReviewAnalysis**：历史记录是模型输出直接落库的，可能是纯文本（旧版），
  // 也可能只有 framework 而缺 key_points/follow_up/pitfalls——直接读 `.length` 会抛
  // TypeError（"查看详情"白屏的真实原因）。归一化后用 null 表示"没有可展示的分析"。
  const viewAnalysis: InterviewAnalysis | null = record
    ? normalizeReviewAnalysis(record.analysis)
    : normalizeReviewAnalysis(analysis);
  // 建议展示：刚生成的 optimizeResult 优先（含记录模式下反向优化新产出的建议），否则回退历史记录里已持久化的建议。
  // 同样归一化：历史建议可能缺 evidence / 字段类型不对。
  const viewSuggestions: InterviewOptimizeResult["suggestions"] = optimizeResult?.suggestions
    ? normalizeSuggestions(optimizeResult.suggestions)
    : record
      ? normalizeSuggestions(record.suggestions)
      : [];

  // 旧版纯文本记录（analysis 为字符串）兼容：只展示提示，不崩。
  const legacyText = record && typeof record.analysis === "string" ? record.analysis : null;

  // 打开历史记录时，用其中持久化的分析与建议填充展示状态（不重新调用模型），并预填关联的岗位/简历。
  // Compiler 规范：随 record 变化的回填用渲染期守卫式调整（哨兵 null 覆盖挂载场景）。
  const [prevRecord, setPrevRecord] = useState<InterviewReviewRecord | null | undefined>(record);
  if (prevRecord !== record) {
    setPrevRecord(record);
    // 切换记录（含关闭历史视图）时丢掉上一条手填的内容，避免串味。
    setWeaknesses(null);
    setFollowUps(null);
    if (record) {
      // 归一化后再进 state：否则后续「反向优化」会把缺字段的对象原样写回服务端。
      setAnalysis(normalizeReviewAnalysis(record.analysis));
      const storedSuggestions = normalizeSuggestions(record.suggestions);
      setOptimizeResult(
        storedSuggestions.length
          ? {
              resume_id: record.resume_id ?? 0,
              suggestions: storedSuggestions,
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

  // 反向优化的提交值（问题 12）：手填值优先，未编辑则回落到模型分析。
  // 两者都空时按钮禁用——**可点条件必须等于后端的 `require_some_input`**，否则又会撞 422。
  const rawWeaknesses = weaknesses ?? viewAnalysis?.pitfalls ?? [];
  const rawFollowUps = followUps ?? viewAnalysis?.follow_up ?? [];
  const effectiveWeaknesses = normalizeOptimizeItems(rawWeaknesses);
  const effectiveFollowUps = normalizeOptimizeItems(rawFollowUps);
  const canOptimize = effectiveWeaknesses.length > 0 || effectiveFollowUps.length > 0;
  // 后端 `MAX_OPTIMIZE_ITEMS = 20`：超出的部分提交前截断，并明确告诉用户，而不是等 422。
  const optimizeTruncated =
    rawWeaknesses.filter((line) => line.trim()).length > OPTIMIZE_ITEM_LIMIT ||
    rawFollowUps.filter((line) => line.trim()).length > OPTIMIZE_ITEM_LIMIT;

  const analyze = async () => {
    if (!record && !question.trim()) {
      message.error(t("interviewReview.error.needQuestion"));
      return;
    }
    const outcome = await analyzeRequest.run((signal) =>
      analyzeInterviewQuestion(
        {
          question: (record?.questions?.[0] ?? question).trim(),
          job_id: jobId ?? null,
          resume_id: resumeId ?? null,
        },
        signal,
      ),
    );
    if (outcome.status === "ok") {
      setAnalysis(outcome.data);
      setOptimizeResult(null);
      // 分析出思路后自动保存为历史（无需用户手点保存）。
      await persistReview(outcome.data, []);
      return;
    }
    if (outcome.status === "error") {
      message.error(errorText(outcome.error, t("interviewReview.error.analyzeFailed")));
    }
    // aborted：用户自己按了停止——不弹错误、不动上一次的分析结果。
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
    // 兜底：按钮已禁用，但键盘/程序化触发仍可能走到这里；发请求必然 422。
    if (!canOptimize) {
      message.error(t("interviewReview.optimize.needInput"));
      return;
    }
    const outcome = await optimizeRequest.run((signal) =>
      optimizeResumeFromInterview(
        {
          resume_id: resumeId,
          job_id: jobId ?? null,
          weaknesses: effectiveWeaknesses,
          follow_ups: effectiveFollowUps,
        },
        signal,
      ),
    );
    if (outcome.status === "error") {
      message.error(errorText(outcome.error, t("interviewReview.error.optimizeFailed")));
      return;
    }
    if (outcome.status === "aborted") return;
    setOptimizeResult(outcome.data);
    // 历史记录富还原：把新生成的建议**和手填的短板/追问**写回同一条记录。
    // `analysis` 是 JSON 列，写回即"重开还在"，零迁移、零契约变更。
    if (record) {
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
            time: formatServerTime(record.created_at),
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
              {analyzing && <AbortButton onClick={() => analyzeRequest.cancel()} />}
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
          {/* 问题 12：这里是**唯一**的短板/追问入口（历史模式下也一样）。
              以前是只读 `<ul>`，用户看得见却改不了，点「反向优化」只会撞 422。
              用 `key` 让切记录时重挂载：TextBox 的自动高度等内部状态不跨记录。 */}
          <div key={record?.id ?? "live"} style={{ marginTop: 8 }}>
            <Typography.Text strong>{t("interviewReview.field.weaknesses")}</Typography.Text>
            <Input.TextArea
              aria-label={t("interviewReview.field.weaknesses")}
              value={rawWeaknesses.join("\n")}
              autoSize={{ minRows: 2, maxRows: 6 }}
              placeholder={t("interviewReview.placeholder.weaknesses")}
              onChange={(event) => setWeaknesses(splitOptimizeLines(event.target.value))}
              style={{ marginTop: 4, marginBottom: 12 }}
            />
            <Typography.Text strong>{t("interviewReview.field.followUps")}</Typography.Text>
            <Input.TextArea
              aria-label={t("interviewReview.field.followUps")}
              value={rawFollowUps.join("\n")}
              autoSize={{ minRows: 2, maxRows: 6 }}
              placeholder={t("interviewReview.placeholder.followUps")}
              onChange={(event) => setFollowUps(splitOptimizeLines(event.target.value))}
              style={{ marginTop: 4 }}
            />
            {optimizeTruncated && (
              <div style={{ marginTop: 8 }}>
                <Typography.Text type="warning">
                  {t("interviewReview.optimize.truncated", { limit: OPTIMIZE_ITEM_LIMIT })}
                </Typography.Text>
              </div>
            )}
          </div>
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
              disabled={!canOptimize}
              onClick={() => void optimize()}
            >
              {t("interviewReview.action.optimize")}
            </Button>
            {optimizing && <AbortButton onClick={() => optimizeRequest.cancel()} />}
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
          {!canOptimize && (
            // 三档数据过去只由模型产出，历史记录里常常两个数组都空；
            // 说清"该怎么让它变可点"，而不是让用户对着灰按钮猜。
            <div style={{ marginTop: 8 }}>
              <Typography.Text type="secondary">
                {t("interviewReview.optimize.needInput")}
              </Typography.Text>
            </div>
          )}
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
