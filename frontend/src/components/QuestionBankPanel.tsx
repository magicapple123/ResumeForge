// SPDX-License-Identifier: Apache-2.0
/** 个性化题库（R-11）：基于岗位 + 简历 + 台账基线即时生成三类题。
 *
 * 只展示后端算好的题目，**即时计算、不落库**。生成成功后**自动保存**为历史（无需手点保存），
 * 也保留「保存题库」手动按钮。下方「历史题库」回看某次生成的三类题并可删除；点「查看详情」
 * 会用与刚生成时完全相同的渲染路径打开该条历史记录，「参考答案」按钮可点、生成结果写回同一条记录。
 *
 * 旧版历史记录若为纯文本（groups 是字符串），仅做兼容展示并提示"仅可查看"，不崩。
 */
import {
  PlayCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Card, Empty, Select, Space, Tag, Typography } from "antd";
import LoadingBlock from "./common/LoadingBlock";
import { useEffect, useState } from "react";
import {
  deleteQuestionBank,
  generateQuestionBank,
  listQuestionBanks,
  saveQuestionBank,
} from "../api/interview";
import { useQuestionBankAnswers } from "../features/interview/useQuestionBankAnswers";
import AbortButton from "./common/AbortButton";
import { errorText, useAbortableRequest } from "../hooks/useAbortableRequest";
import { useApi } from "../hooks/useApi";
import { useBatchSelection } from "../hooks/useBatchSelection";
import { useJobSearchSelect, useResumeSearchSelect } from "../hooks/remoteSearchOptions";
import type { QuestionBankOut, QuestionBankRecord } from "../types";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import QuestionGroupCards from "./questionbank/QuestionGroupCards";
import BankHistoryCard from "./questionbank/BankHistoryCard";

interface Props {
  onStartSession?: (questions: string[]) => void;
  /** 历史记录富还原：传入一条已保存的题库记录后，用完全相同的渲染路径展示并允许"参考答案"回写。 */
  record?: QuestionBankRecord | null;
  /** 点击历史条目里的「查看详情」时回调，由父组件接管选中。 */
  onOpenRecord?: (record: QuestionBankRecord) => void;
  /** 退出历史查看时回调。 */
  onCloseRecord?: () => void;
}

export default function QuestionBankPanel({
  onStartSession,
  record,
  onOpenRecord,
  onCloseRecord,
}: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const { message, modal } = App.useApp();
  // 岗位 / 简历下拉改为远程搜索（P0-1）：不再由页面预拉"前 100 条"当全量。
  const jobSelect = useJobSearchSelect();
  const resumeSelect = useResumeSearchSelect();
  // 下拉常驻可见：挂载时预拉第一页候选，输入关键词再搜（与旧首屏体验对齐）。
  useEffect(() => {
    void jobSelect.reload();
    void resumeSelect.reload();
    // hook 的回调引用稳定，只在挂载时执行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [jobId, setJobId] = useState<number | undefined>();
  const [resumeId, setResumeId] = useState<number | undefined>();
  // 生成题库是一次「点一下等十几秒」的请求：用统一的中止能力，面板上就有「停止」。
  const generateRequest = useAbortableRequest();
  const loading = generateRequest.loading;
  const [data, setData] = useState<QuestionBankOut | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // 本次生成自动保存出来的记录 id：没有打开历史记录时，"我的作答"也要能落到这条记录上。
  const [savedRecordId, setSavedRecordId] = useState<number | null>(null);
  const banks = useApi(listQuestionBanks, []);

  // 历史富还原：用历史记录的 groups 充当展示数据；否则用刚生成的结果。
  const viewData: QuestionBankOut | null = record
    ? {
        job_id: record.job_id,
        job_title: record.job_title,
        company: record.company,
        resume_id: record.resume_id,
        groups: record.groups as QuestionBankOut["groups"],
        llm_used: true,
        notes: [],
      }
    : data;

  // 旧版纯文本记录（groups 为字符串）兼容：只展示提示，不崩。
  const legacyText = record && typeof record.groups === "string" ? record.groups : null;

  // 换一条历史记录（或退出历史视图）时，写回目标必须换掉：旧记录的 id 不能再用来 PATCH。
  // 参考答案 / 自答 / 批改的种回与作废由 `useQuestionBankAnswers` 按 groups 引用变化处理。
  const [prevRecordSync, setPrevRecordSync] = useState<QuestionBankRecord | null | undefined>(
    record,
  );
  if (prevRecordSync !== record) {
    setPrevRecordSync(record);
    setSavedRecordId(null);
  }

  const generate = async () => {
    if (generateRequest.loading) return;
    if (!record && !jobId && !resumeId) {
      setError(t("questionBankPanel.validate.needJobOrResume"));
      setData(null);
      return;
    }
    setError("");
    const outcome = await generateRequest.run((signal) =>
      generateQuestionBank({ job_id: jobId ?? null, resume_id: resumeId ?? null }, signal),
    );
    if (outcome.status === "ok") {
      setData(outcome.data);
      // 生成完成自动保存为历史（无需用户手点保存）。
      await autoSaveBank(outcome.data);
    } else if (outcome.status === "error") {
      setError(errorText(outcome.error, t("questionBankPanel.error.generate")));
      setData(null);
    }
    // aborted：用户自己按了停止——不清空上一次结果、不弹错误提示（界面已回到可再点）。
  };

  const autoSaveBank = async (result: QuestionBankOut) => {
    setSaving(true);
    try {
      const resumeTitle =
        resumeSelect.options.find((option) => option.value === result.resume_id)?.label ?? "";
      const created = await saveQuestionBank({
        job_id: result.job_id ?? null,
        job_title: result.job_title,
        company: result.company,
        resume_id: result.resume_id ?? null,
        resume_title: resumeTitle,
        groups: result.groups,
        model: "",
      });
      // 记下刚创建的那条记录：没有打开历史记录时，"我的作答"也要有地方落。
      setSavedRecordId(created.id);
      await banks.reload();
    } catch (err) {
      // 自动保存失败不阻断生成结果展示，仅轻提示。
      message.warning(err instanceof Error ? err.message : t("questionBankPanel.error.autoSave"));
    } finally {
      setSaving(false);
    }
  };

  const saveBank = async () => {
    if (!data || saving) return;
    await autoSaveBank(data);
  };

  const startSession = () => {
    if (!data || !onStartSession) return;
    const questions = data.groups.flatMap((group) => group.questions.map((item) => item.question));
    onStartSession(questions);
  };

  const batch = useBatchSelection<number>();

  /** 批量删除：确认后逐条走同一个删除接口，全部完成再刷新一次。 */
  const removeSelected = () => {
    const ids = [...batch.selectedIds];
    if (ids.length === 0) return;
    modal.confirm({
      title: t("questionBankPanel.confirm.bulkDeleteTitle"),
      content: t("questionBankPanel.confirm.bulkDeleteBody", {
        count: ids.length,
        note: t("common.note.trashRecovery"),
      }),
      okText: t("common.action.delete"),
      okButtonProps: { danger: true },
      onOk: async () => {
        const results = await Promise.allSettled(
          (banks.data ?? [])
            .filter((bank) => batch.isSelected(bank.id))
            .map((bank) => deleteQuestionBank(bank.id)),
        );
        const failed = results.filter((item) => item.status === "rejected").length;
        if (failed === 0)
          message.success(t("questionBankPanel.toast.deletedMany", { count: ids.length }));
        else
          message.warning(
            t("questionBankPanel.toast.deletedPartial", {
              ok: ids.length - failed,
              failed,
            }),
          );
        batch.exitSelecting();
        await banks.reload();
      },
    });
  };

  const removeBank = async (id: number) => {
    try {
      await deleteQuestionBank(id);
      message.success(t("questionBankPanel.toast.deleted"));
      await banks.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("questionBankPanel.error.delete"));
    }
  };

  /** 展开/收起某道题的参考答案；展开时带上当前选中的岗位与简历作为背景。查看历史记录时，生成结果写回该记录。 */
  // 参考答案 / 我的作答的状态机整体在 hook 里（面板文件已贴行数预算）。
  const answers = useQuestionBankAnswers({
    groups: viewData?.groups ?? null,
    targetId: record?.id ?? savedRecordId,
    jobId: record?.job_id ?? jobId ?? null,
    resumeId: record?.resume_id ?? resumeId ?? null,
    writeBackFailedText: t("questionBankPanel.error.answerWriteBack"),
    generateFailedText: t("questionBankPanel.error.answer"),
    reviewFailedText: t("questionBankPanel.error.reviewAnswer"),
    onWarn: (text) => message.warning(text),
  });

  const total = Array.isArray(viewData?.groups)
    ? viewData.groups.reduce((sum, group) => sum + group.questions.length, 0)
    : 0;

  return (
    <Space orientation="vertical" style={{ width: "100%" }} size="middle">
      {record && (
        <Alert
          type="info"
          showIcon
          title={t("questionBankPanel.history.viewingTitle", {
            id: record.id,
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
        <Card size="small" title={t("questionBankPanel.page.title")}>
          <Space wrap>
            <Select
              allowClear
              style={{ minWidth: 240 }}
              placeholder={t("questionBankPanel.select.jobPlaceholder")}
              value={jobId}
              onChange={setJobId}
              {...jobSelect.selectProps}
            />
            <Select
              allowClear
              style={{ minWidth: 240 }}
              placeholder={t("questionBankPanel.select.resumePlaceholder")}
              value={resumeId}
              onChange={setResumeId}
              {...resumeSelect.selectProps}
            />
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={loading}
              onClick={() => void generate()}
            >
              {t("questionBankPanel.action.generate")}
            </Button>
            {/* 生成中：「停止」与主按钮并列出现，点了立刻回到可再点（不弹错误）。 */}
            {loading && <AbortButton onClick={() => generateRequest.cancel()} />}
            {data && (
              <>
                <Button
                  icon={<PlayCircleOutlined />}
                  disabled={total === 0}
                  onClick={() => void startSession()}
                >
                  {t("questionBankPanel.action.startSession")}
                </Button>
                <Button icon={<SaveOutlined />} loading={saving} onClick={() => void saveBank()}>
                  {t("questionBankPanel.action.save")}
                </Button>
              </>
            )}
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            {t("questionBankPanel.page.description")}
          </Typography.Paragraph>
        </Card>
      )}

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <Alert type="error" showIcon title={error} />
      ) : !viewData ? (
        <Empty
          description={
            record
              ? t("questionBankPanel.empty.recordEmpty")
              : t("questionBankPanel.empty.needSelection")
          }
        />
      ) : legacyText ? (
        <Card size="small" title={t("questionBankPanel.history.title")}>
          <Alert
            type="warning"
            showIcon
            title={t("questionBankPanel.history.legacyTitle")}
            description={t("questionBankPanel.history.legacyBody")}
          />
          <Typography.Paragraph style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
            {legacyText}
          </Typography.Paragraph>
        </Card>
      ) : (
        <>
          {viewData.notes.map((note) => (
            <Alert key={note} type="warning" showIcon title={note} />
          ))}
          {answers.answerError && <Alert type="error" showIcon title={answers.answerError} />}
          <Space wrap>
            <Typography.Text strong>
              {t("questionBankPanel.summary.total", { count: total })}
            </Typography.Text>
            {viewData.groups.map((group) =>
              group.questions.length ? (
                <Tag key={group.type} color="geekblue">
                  {group.type} {group.questions.length}
                </Tag>
              ) : null,
            )}
            {!record && (
              <Button size="small" icon={<ReloadOutlined />} onClick={() => void generate()}>
                {t("questionBankPanel.action.regenerate")}
              </Button>
            )}
          </Space>
          <QuestionGroupCards
            groups={viewData.groups}
            answerMap={answers.answerMap}
            answerOpen={answers.answerOpen}
            answerLoading={answers.answerLoading}
            onToggleAnswer={answers.toggleAnswer}
            onRegenerateAnswer={answers.regenerateAnswer}
            myAnswerMap={answers.myAnswerMap}
            reviewMap={answers.reviewMap}
            myAnswerOpen={answers.myAnswerOpen}
            reviewLoading={answers.reviewLoading}
            reviewError={answers.reviewError}
            onToggleMyAnswer={answers.toggleMyAnswer}
            onCancelActive={answers.cancelActive}
            onSubmitMyAnswer={answers.submitMyAnswer}
          />
        </>
      )}

      <BankHistoryCard
        banks={banks}
        batch={batch}
        onOpenRecord={onOpenRecord}
        onRemoveBank={removeBank}
        removeSelected={removeSelected}
      />
    </Space>
  );
}
