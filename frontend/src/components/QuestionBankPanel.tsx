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
import { Alert, App, Button, Card, Empty, Select, Space, Spin, Tag, Typography } from "antd";
import { useState } from "react";
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
import type { QuestionAnswer, QuestionBankOut, QuestionBankRecord } from "../types";
import QuestionGroupCards from "./questionbank/QuestionGroupCards";
import BankHistoryCard from "./questionbank/BankHistoryCard";

interface Props {
  jobOptions: { value: number; label: string }[];
  resumeOptions: { value: number; label: string }[];
  onStartSession?: (questions: string[]) => void;
  /** 历史记录富还原：传入一条已保存的题库记录后，用完全相同的渲染路径展示并允许"参考答案"回写。 */
  record?: QuestionBankRecord | null;
  /** 点击历史条目里的「查看详情」时回调，由父组件接管选中。 */
  onOpenRecord?: (record: QuestionBankRecord) => void;
  /** 退出历史查看时回调。 */
  onCloseRecord?: () => void;
}

export default function QuestionBankPanel({
  jobOptions,
  resumeOptions,
  onStartSession,
  record,
  onOpenRecord,
  onCloseRecord,
}: Props) {
  const { message, modal } = App.useApp();
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
  const [prevRecordSync, setPrevRecordSync] = useState<{ record: QuestionBankRecord | null | undefined; legacyText: string | null } | null>(null);
  if (prevRecordSync === null || prevRecordSync.record !== record || prevRecordSync.legacyText !== legacyText) {
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
      setError("请至少选择一个岗位或一份简历，题库才能有针对性");
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
      setError(err instanceof Error ? err.message : "生成题库失败");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const autoSaveBank = async (result: QuestionBankOut) => {
    setSaving(true);
    try {
      const resumeTitle =
        resumeOptions.find((option) => option.value === result.resume_id)?.label ?? "";
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
      message.warning(err instanceof Error ? err.message : "自动保存题库历史失败");
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
      title: `删除选中的 ${ids.length} 份题库历史？`,
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        const results = await Promise.allSettled(
          (banks.data ?? [])
            .filter((bank) => batch.isSelected(bank.id))
            .map((bank) => deleteQuestionBank(bank.id)),
        );
        const failed = results.filter((item) => item.status === "rejected").length;
        if (failed === 0) message.success(`已删除 ${ids.length} 份题库历史`);
        else message.warning(`已删除 ${ids.length - failed} 份，${failed} 份失败，请重试`);
        batch.exitSelecting();
        await banks.reload();
      },
    });
  };

  const removeBank = async (id: number) => {
    try {
      await deleteQuestionBank(id);
      message.success("已删除题库历史");
      await banks.reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除题库历史失败");
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
          message.warning(err instanceof Error ? err.message : "参考答案已生成，但写回历史失败");
        }
      }
    } catch (err) {
      setAnswerError(err instanceof Error ? err.message : "生成参考答案失败");
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
          title={`正在查看历史题库 #${record.id}（${record.created_at.replace("T", " ").slice(0, 16)}）`}
          action={
            onCloseRecord && (
              <Button size="small" onClick={onCloseRecord}>
                返回
              </Button>
            )
          }
        />
      )}

      {!record && (
        <Card size="small" title="个性化题库">
          <Space wrap>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              style={{ minWidth: 240 }}
              placeholder="关联岗位（选填）"
              value={jobId}
              onChange={setJobId}
              options={jobOptions}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              style={{ minWidth: 240 }}
              placeholder="关联简历（选填）"
              value={resumeId}
              onChange={setResumeId}
              options={resumeOptions}
            />
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={loading}
              onClick={() => void generate()}
            >
              生成题库
            </Button>
            {data && (
              <>
                <Button
                  icon={<PlayCircleOutlined />}
                  disabled={total === 0}
                  onClick={() => void startSession()}
                >
                  开始模拟面试
                </Button>
                <Button icon={<SaveOutlined />} loading={saving} onClick={() => void saveBank()}>
                  保存题库
                </Button>
              </>
            )}
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            题库基于岗位 JD、简历与已确认的事实台账即时生成，覆盖基础题、项目深挖题与反问 HR
            题三类。
          </Typography.Paragraph>
        </Card>
      )}

      {loading ? (
        <Spin />
      ) : error ? (
        <Alert type="error" showIcon title={error} />
      ) : !viewData ? (
        <Empty description={record ? "该历史记录为空" : "选择岗位或简历后生成题库"} />
      ) : legacyText ? (
        <Card size="small" title="历史题库">
          <Alert
            type="warning"
            showIcon
            title="此为旧版记录，仅可查看"
            description="旧版历史以纯文本保存，无法还原为结构化题库，仅展示原始内容。"
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
            <Typography.Text strong>共 {total} 题</Typography.Text>
            {viewData.groups.map((group) =>
              group.questions.length ? (
                <Tag key={group.type} color="geekblue">
                  {group.type} {group.questions.length}
                </Tag>
              ) : null,
            )}
            {!record && (
              <Button size="small" icon={<ReloadOutlined />} onClick={() => void generate()}>
                重新生成
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
