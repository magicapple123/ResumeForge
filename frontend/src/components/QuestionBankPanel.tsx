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
  generateQuestionAnswer,
  generateQuestionBank,
  listQuestionBanks,
  saveQuestionBank,
  updateQuestionBank,
} from "../api/interview";
import { useApi } from "../hooks/useApi";
import { useBatchSelection } from "../hooks/useBatchSelection";
import { useJobSearchSelect, useResumeSearchSelect } from "../hooks/remoteSearchOptions";
import type { QuestionAnswer, QuestionBankOut, QuestionBankRecord } from "../types";
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
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<QuestionBankOut | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // 单题参考答案：按「分组-序号」键控，展开即缓存，收起即丢弃；不落库、不自动发送。
  const [answerMap, setAnswerMap] = useState<Record<string, QuestionAnswer>>({});
  const [answerLoading, setAnswerLoading] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState("");
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

  // 打开历史记录时，若其中已持久化参考答案，预填到 answerMap，使其直接渲染出来。
  // Compiler 规范：随 record 变化的派生回填用渲染期守卫式调整（哨兵 null 保证
  // "挂载即带 record"的首次渲染也走一次，与原 effect 语义一致）。
  const [prevRecordSync, setPrevRecordSync] = useState<{
    record: QuestionBankRecord | null | undefined;
    legacyText: string | null;
  } | null>(null);
  if (
    prevRecordSync === null ||
    prevRecordSync.record !== record ||
    prevRecordSync.legacyText !== legacyText
  ) {
    setPrevRecordSync({ record, legacyText });
    if (!record || legacyText) {
      setAnswerMap({});
    } else {
      const seeded: Record<string, QuestionAnswer> = {};
      record.groups.forEach((group) =>
        group.questions.forEach((item, index) => {
          if (item.answer || (item.key_points && item.key_points.length)) {
            seeded[`${group.type}-${index}`] = {
              question: item.question,
              answer: item.answer ?? "",
              key_points: item.key_points ?? [],
              sample_phrasing: item.sample_phrasing ?? "",
            };
          }
        }),
      );
      setAnswerMap(seeded);
    }
  }

  const generate = async () => {
    if (loading) return;
    if (!record && !jobId && !resumeId) {
      setError(t("questionBankPanel.validate.needJobOrResume"));
      setData(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await generateQuestionBank({
        job_id: jobId ?? null,
        resume_id: resumeId ?? null,
      });
      setData(result);
      // 生成完成自动保存为历史（无需用户手点保存）。
      await autoSaveBank(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("questionBankPanel.error.generate"));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const autoSaveBank = async (result: QuestionBankOut) => {
    setSaving(true);
    try {
      const resumeTitle =
        resumeSelect.options.find((option) => option.value === result.resume_id)?.label ?? "";
      await saveQuestionBank({
        job_id: result.job_id ?? null,
        job_title: result.job_title,
        company: result.company,
        resume_id: result.resume_id ?? null,
        resume_title: resumeTitle,
        groups: result.groups,
        model: "",
      });
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
  const toggleAnswer = async (
    key: string,
    question: string,
    groupType?: string,
    index?: number,
  ) => {
    if (answerMap[key]) {
      setAnswerMap((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }
    if (answerLoading) return;
    setAnswerLoading(key);
    setAnswerError("");
    try {
      const answer = await generateQuestionAnswer({
        question,
        job_id: record?.job_id ?? jobId ?? null,
        resume_id: record?.resume_id ?? resumeId ?? null,
      });
      setAnswerMap((current) => ({ ...current, [key]: answer }));
      // 历史记录富还原：把新生成的参考答案写回同一条记录。
      if (record && groupType !== undefined && index !== undefined) {
        try {
          const groups = record.groups.map((group) =>
            group.type === groupType
              ? {
                  ...group,
                  questions: group.questions.map((item, i) =>
                    i === index
                      ? {
                          ...item,
                          answer: answer.answer,
                          key_points: answer.key_points,
                          sample_phrasing: answer.sample_phrasing,
                        }
                      : item,
                  ),
                }
              : group,
          );
          await updateQuestionBank(record.id, { groups });
        } catch (err) {
          message.warning(
            err instanceof Error ? err.message : t("questionBankPanel.error.answerWriteBack"),
          );
        }
      }
    } catch (err) {
      setAnswerError(err instanceof Error ? err.message : t("questionBankPanel.error.answer"));
    } finally {
      setAnswerLoading(null);
    }
  };

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
          {answerError && <Alert type="error" showIcon title={answerError} />}
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
            answerMap={answerMap}
            answerLoading={answerLoading}
            toggleAnswer={toggleAnswer}
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
