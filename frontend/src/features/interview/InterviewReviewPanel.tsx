// SPDX-License-Identifier: Apache-2.0
/** 面试复盘（R-11 补）：录入真实被问问题 → 分析答题思路 → 反向优化简历。
 *
 * 复用已就绪的 analyzeInterviewQuestion / optimizeResumeFromInterview 接口，不另造。反向优化只产出
 * 建议列表、不改正文。分析出思路后**自动保存**为历史（无需手点保存），也保留「保存复盘」按钮。
 *
 * 历史记录富还原：传入 record 后用与刚生成时相同的渲染路径展示，「反向优化简历」按钮可点、生成结果
 * 写回同一条记录。旧版纯文本记录（analysis 为字符串）仅做兼容展示并提示"仅可查看"。
 *
 * Q3 起本文件只做**编排**（状态 + 调接口），三块界面各在自己的文件里：
 * `ReviewSetupCard`（问题/岗位/简历来源）、`ReviewAnalysisCard`（思路 + 短板/追问）、
 * `ReviewHistoryCard`（历史列表）。原因很实际：复盘要支持内部简历 / 外部简历 / 导入文件
 * 三种来源，光这一块的状态就足以把单文件顶过 500 行预算。
 *
 * 简历来源的口径（零迁移）：
 * - 内部简历 → 提交 `resume_id`，历史里写 `resume_id`；
 * - 外部简历 / 导入文件 → 提交 `resume_text` + `resume_title`，历史里写
 *   `resume_id: null` + `resume_title`（`InterviewReviewRecord` 本来就有这个字段）。
 */
import { App, Space } from "antd";
import { useEffect, useState } from "react";
import EmptyState from "../../components/common/EmptyState";
import {
  analyzeInterviewQuestion,
  deleteReview,
  listReviews,
  optimizeResumeFromInterview,
  saveReview,
  updateReview,
} from "../../api/interview";
import ReviewAnalysisCard from "./ReviewAnalysisCard";
import ReviewHistoryCard from "./ReviewHistoryCard";
import ReviewRecordHeader from "./ReviewRecordHeader";
import ReviewSetupCard, { ReviewResumeField } from "./ReviewSetupCard";
import ReviewOutcomeCards from "./ReviewOutcomeCards";
import {
  normalizeOptimizeItems,
  normalizeReviewAnalysis,
  normalizeSuggestions,
  OPTIMIZE_ITEM_LIMIT,
  splitOptimizeLines,
} from "./normalizeReview";
import { errorText, useAbortableRequest } from "../../hooks/useAbortableRequest";
import { useApi } from "../../hooks/useApi";
import { useJobSearchSelect } from "../../hooks/remoteSearchOptions";
import {
  externalResumeMaterial,
  externalResumeValue,
  internalResumeValue,
  parseResumeValue,
  useInterviewResumeSelect,
} from "../../hooks/useInterviewResumeSelect";
import type { MaterialSourceMode } from "../../pages/interview/MaterialSourceField";
import type {
  InterviewAnalysis,
  InterviewMaterialExtract,
  InterviewOptimizeResult,
  InterviewReviewRecord,
} from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  onGoToResume?: () => void;
  /** 历史记录富还原：传入一条已保存的复盘记录后，用相同的渲染路径展示并允许「反向优化简历」回写。 */
  record?: InterviewReviewRecord | null;
  /** 点击历史条目里的「查看详情」时回调，由父组件接管选中。 */
  onOpenRecord?: (record: InterviewReviewRecord) => void;
  /** 退出历史查看时回调。 */
  onCloseRecord?: () => void;
}

/** 记录侧选中的简历：内部简历与外部简历都带 id，区别只在提交时走哪条路。 */
type ResumeChoice = { kind: "internal" | "external"; id: number };

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
  useEffect(() => {
    void jobSelect.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [question, setQuestion] = useState("");
  const [jobId, setJobId] = useState<number | undefined>();
  // 简历来源：`resumeMode` 决定"记录侧还是文件侧"，两侧的材料分开存、切换时互相清空，
  // 避免"上边选着记录，下边还留着上次的文件正文"这种谁也说不清的状态。
  const [resumeMode, setResumeMode] = useState<MaterialSourceMode>("record");
  const [resumeChoice, setResumeChoice] = useState<ResumeChoice | null>(null);
  const [resumeMaterial, setResumeMaterial] = useState<InterviewMaterialExtract | null>(null);
  // 分析思路与反向优化都是一次「点一下等十几秒」的生成：各自可停，互不影响。
  const analyzeRequest = useAbortableRequest();
  const optimizeRequest = useAbortableRequest();
  const analyzing = analyzeRequest.loading;
  const optimizing = optimizeRequest.loading;
  const [analysis, setAnalysis] = useState<InterviewAnalysis | null>(null);
  const [optimizeResult, setOptimizeResult] = useState<InterviewOptimizeResult | null>(null);
  // F01：记录态独立作用域。打开/关闭历史**不得**修改工作区的 analysis / optimizeResult /
  // jobId / 简历选择——旧实现把记录内容灌进共享 state，关闭记录后它"冒充"成工作区结果。
  const [recordOptimizeResult, setRecordOptimizeResult] = useState<InterviewOptimizeResult | null>(
    null,
  );
  const [recordResumeMode, setRecordResumeMode] = useState<MaterialSourceMode>("record");
  const [recordResumeChoice, setRecordResumeChoice] = useState<ResumeChoice | null>(null);
  const [recordResumeMaterial, setRecordResumeMaterial] = useState<InterviewMaterialExtract | null>(
    null,
  );
  // F02/F03：工作态自动保存后拿到的记录 id。非空 = 已经入库，保存按钮收起、反向优化写回它。
  const [workRecordId, setWorkRecordId] = useState<number | null>(null);
  // 反向优化的两个可编辑输入（问题 12）：`null` = 用户没改过 → 回落到模型分析值。
  // 不用「props 灌 state」：那会把编辑值混进 `viewAnalysis`（record.analysis 的派生只读视图）。
  const [weaknesses, setWeaknesses] = useState<string[] | null>(null);
  const [followUps, setFollowUps] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const reviews = useApi(listReviews, []);

  // 当前作用域：记录态用 record.*（及其独立 state），工作态用工作区 state。
  // 所有"会写状态"的回调都经这三个 setter 落到正确的一侧（F01）。
  const activeJobId = record ? record.job_id : jobId;
  const activeResumeMode = record ? recordResumeMode : resumeMode;
  const activeResumeChoice = record ? recordResumeChoice : resumeChoice;
  const activeResumeMaterial = record ? recordResumeMaterial : resumeMaterial;
  const setActiveChoice = (choice: ResumeChoice | null) => {
    if (record) setRecordResumeChoice(choice);
    else setResumeChoice(choice);
  };
  const setActiveMaterial = (material: InterviewMaterialExtract | null) => {
    if (record) setRecordResumeMaterial(material);
    else setResumeMaterial(material);
  };
  const setActiveMode = (mode: MaterialSourceMode) => {
    if (record) setRecordResumeMode(mode);
    else setResumeMode(mode);
  };

  /** 下拉里当前的值：`r:<内部 id>` / `e:<外部 id>`；文件来源时下拉不渲染。 */
  const resumeValue =
    activeResumeMode === "record" && activeResumeChoice
      ? activeResumeChoice.kind === "internal"
        ? internalResumeValue(activeResumeChoice.id)
        : externalResumeValue(activeResumeChoice.id)
      : undefined;

  const resumeSelect = useInterviewResumeSelect({
    jobId: activeJobId ?? null,
    value: resumeValue,
    // 外部简历先取正文（没有正文的候选在 hook 里就已经禁用），再落成"文件侧的材料"。
    onExternal: (external) => {
      setActiveChoice({ kind: "external", id: external.id });
      setActiveMaterial(externalResumeMaterial(external));
      message.info(t("interviewPage.setup.external.prefilled", { name: external.name }));
    },
    onExternalFailed: () => message.warning(t("interviewPage.setup.external.loadFailed")),
    onSelectInternal: (raw) => {
      const parsed = parseResumeValue(raw);
      if (parsed?.kind === "internal") {
        setActiveChoice({ kind: "internal", id: parsed.id });
        setActiveMaterial(null);
        return;
      }
      setActiveChoice(null);
      setActiveMaterial(null);
    },
  });

  // 岗位一变就重拉简历候选：上一次的候选属于上一个岗位，留着会让人挑到不该出现的简历。
  useEffect(() => {
    resumeSelect.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobId]);

  // 历史富还原：用历史记录的 analysis/suggestions 充当展示数据。
  // **必须过 normalizeReviewAnalysis**：历史记录是模型输出直接落库的，可能是纯文本（旧版），
  // 也可能只有 framework 而缺 key_points/follow_up/pitfalls——直接读 `.length` 会抛
  // TypeError（"查看详情"白屏的真实原因）。归一化后用 null 表示"没有可展示的分析"。
  const viewAnalysis: InterviewAnalysis | null = record
    ? normalizeReviewAnalysis(record.analysis)
    : normalizeReviewAnalysis(analysis);
  // 建议展示：记录态只读记录自己的（含本次新生成的），工作态只读工作区——两处不互相污染。
  const viewSuggestions: InterviewOptimizeResult["suggestions"] = record
    ? normalizeSuggestions(recordOptimizeResult?.suggestions ?? record.suggestions)
    : optimizeResult?.suggestions
      ? normalizeSuggestions(optimizeResult.suggestions)
      : [];

  // 旧版纯文本记录（analysis 为字符串）兼容：只展示提示，不崩。
  const legacyText = record && typeof record.analysis === "string" ? record.analysis : null;

  // 打开/关闭历史：**只动记录态**。工作区的 analysis / optimizeResult / jobId / 简历选择
  // 从头到尾不参与，所以关闭记录后不需要"恢复"任何东西（F01）。
  // Compiler 规范：随 record 变化的回填用渲染期守卫式调整（哨兵 null 覆盖挂载场景）。
  const [prevRecord, setPrevRecord] = useState<InterviewReviewRecord | null | undefined>(record);
  if (prevRecord !== record) {
    setPrevRecord(record);
    // 切换记录（含关闭历史视图）时丢掉上一条手填的内容，避免串味。
    setWeaknesses(null);
    setFollowUps(null);
    const storedSuggestions = record ? normalizeSuggestions(record.suggestions) : [];
    setRecordOptimizeResult(
      storedSuggestions.length
        ? {
            // 契约变更（Q3）：外部简历的复盘没有内部 id，null 就是"没有"，不再拿 0 冒充。
            resume_id: record?.resume_id ?? null,
            suggestions: storedSuggestions,
            llm_used: true,
            notes: [],
          }
        : null,
    );
    // 历史里的简历只有 id 能还原（外部/上传的正文不进历史，零迁移的代价）：
    // 记录页因此保留简历来源控件，用户补选一次就能继续反向优化。
    setRecordResumeMode("record");
    setRecordResumeChoice(record?.resume_id ? { kind: "internal", id: record.resume_id } : null);
    setRecordResumeMaterial(null);
  }

  // 历史富还原的已选值保显示（P0-1）：记录里的岗位往往不在第一页候选里，按 id 回查补进候选。
  useEffect(() => {
    if (!record) return;
    void jobSelect.ensure(record.job_id);
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

  // 内部简历走 `resume_id`；外部简历与导入文件走 `resume_text` + `resume_title`。
  const internalResumeId = activeResumeChoice?.kind === "internal" ? activeResumeChoice.id : null;
  const hasResume =
    internalResumeId !== null || (activeResumeMaterial?.text.trim().length ?? 0) > 0;
  const resumeTitle =
    internalResumeId !== null
      ? (resumeSelect.labelFor(resumeValue) ?? "")
      : (activeResumeMaterial?.name ?? "");
  // 只有"没有内部 id 但有正文"时才带文本：内部简历的正文由后端从记录里读，重复带上只会变脏。
  const materialPayload =
    internalResumeId === null && activeResumeMaterial
      ? { resume_text: activeResumeMaterial.text, resume_title: activeResumeMaterial.name }
      : {};

  const changeResumeMode = (mode: MaterialSourceMode) => {
    setActiveMode(mode);
    // 换来源就丢掉另一侧的选择：留着一份"界面不在、提交却生效"的材料是最坏的状态。
    setActiveChoice(null);
    setActiveMaterial(null);
  };

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
          resume_id: internalResumeId,
          ...materialPayload,
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
      // F02：记住这条记录的 id。自动保存成功后它就是"已入库"的唯一凭据——按钮据此收起，
      // 反向优化也据此 PATCH 同一条而不是再 POST 一条。
      const saved = await saveReview({
        job_id: jobId ?? null,
        job_title: jobSelect.options.find((option) => option.value === jobId)?.label ?? "",
        company: "",
        resume_id: internalResumeId,
        resume_title: resumeTitle,
        questions: analysisObj.question ? [analysisObj.question] : [],
        analysis: analysisObj,
        suggestions: suggestions ?? [],
        model: "",
      });
      if (saved && typeof saved.id === "number") setWorkRecordId(saved.id);
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
      await reviews.reload();
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
      await reviews.reload();
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("interviewReview.error.deleteFailed"),
      );
    }
  };

  // 简历来源控件：新建时在设定卡里，历史查看态在「答题思路」卡里（反向优化要用它）。
  const resumeField = (
    <ReviewResumeField
      mode={activeResumeMode}
      material={activeResumeMaterial}
      select={resumeSelect}
      value={resumeValue}
      disabled={analyzing || optimizing}
      onModeChange={changeResumeMode}
      onMaterialChange={(material) => {
        setActiveMaterial(material);
        setActiveChoice(null);
      }}
    />
  );

  // 查看态卡片头（R-11：拆到 ReviewRecordHeader，面板只留编排）。

  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="middle">
      {record && <ReviewRecordHeader record={record} onCloseRecord={onCloseRecord} />}

      {!record && (
        <ReviewSetupCard
          question={question}
          onQuestionChange={setQuestion}
          jobSelect={jobSelect}
          jobId={jobId}
          onJobChange={setJobId}
          resumeField={resumeField}
          analyzing={analyzing}
          onAnalyze={() => void analyze()}
          onAbort={() => analyzeRequest.cancel()}
        />
      )}

      {viewAnalysis ? (
        <ReviewAnalysisCard
          analysis={viewAnalysis}
          weaknessesText={rawWeaknesses.join("\n")}
          followUpsText={rawFollowUps.join("\n")}
          onWeaknessesChange={(text) => setWeaknesses(splitOptimizeLines(text))}
          onFollowUpsChange={(text) => setFollowUps(splitOptimizeLines(text))}
          truncated={optimizeTruncated}
          canOptimize={canOptimize}
          optimizing={optimizing}
          onOptimize={() => void optimize()}
          onAbort={() => optimizeRequest.cancel()}
          // 历史查看态：简历来源要能补选（外部/上传的正文不进历史）。
          resumeField={record ? resumeField : undefined}
          // F02：自动保存已入库时收起按钮（再点只会重复入库）；保存失败时按钮留着当重试。
          onSave={record || workRecordId !== null ? undefined : () => void saveReviewRecord()}
          saving={saving}
          resetKey={record?.id ?? "live"}
        />
      ) : (
        !record && <EmptyState description={t("interviewReview.empty")} />
      )}

      <ReviewOutcomeCards
        legacyText={legacyText}
        suggestions={viewSuggestions}
        onGoToResume={internalResumeId !== null ? onGoToResume : undefined}
      />

      {/* 历史列表只在"没在查看某一条"时出现：否则屏幕上会有两份内容，还分不清哪份是详情。 */}
      {!record && (
        <ReviewHistoryCard
          reviews={reviews.data ?? null}
          loading={reviews.loading}
          error={reviews.error}
          onOpenRecord={onOpenRecord}
          onRemove={(id) => void removeReview(id)}
        />
      )}
    </Space>
  );
}
