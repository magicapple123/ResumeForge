// SPDX-License-Identifier: Apache-2.0
/**
 * 模拟面试：设定面试官 → 逐轮问答 → 结束后看评分报告。
 *
 * 与求职助手的差别：这里**流程由代码控制**（轮数、何时结束、什么时候出报告），所以界面上
 * 会明确显示"第 N/6 轮"，用户始终知道还剩几个问题；助手那边则是自由对话。
 */
import { ArrowLeftOutlined, StopOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Space, Tabs, Tag, Typography } from "antd";
import LoadingBlock from "../components/common/LoadingBlock";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  createInterview,
  deleteInterview,
  finishInterview,
  getInterview,
  interviewToMaterial,
  listInterviews,
  submitInterviewAnswerStream,
} from "../api/interview";
import InterviewExperiencePanel from "../components/InterviewExperiencePanel";
import InterviewReviewPanel from "../components/InterviewReviewPanel";
import QuestionBankPanel from "../components/QuestionBankPanel";
import { useBatchSelection } from "../hooks/useBatchSelection";
import { HistoryCard } from "./interview/HistoryCard";
import { JANE_FACE_SOURCES, janeFaceForStyle } from "./interview/janeFaces";
import { ReportCard } from "./interview/ReportCard";
import { SetupForm, SetupTab } from "./interview/SetupTab";
import type {
  InterviewBrief,
  InterviewDetail,
  InterviewReviewRecord,
  QuestionBankRecord,
} from "../types";
import { AUTO_FINISH_MAX_ROUNDS, AUTO_ROUNDS_FLAG } from "../types";
import { AUTO_ROUNDS_OPTION } from "../pages/interview/SetupTab";
import { HARD_DELETE_NOTE } from "../components/common/rowActionMenu";
import { formatDateTime } from "../utils/format";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

/** 每页条数之类没有；这里是深链 ?job_id= 的解析：正整数才认，其余按"没带参"处理。 */
function parseLinkedJobId(raw: string | null): number | undefined {
  const parsed = Number(raw);
  return raw && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export default function InterviewPage() {
  useLocale();
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  // 岗位详情「模拟面试」深链带来的预填（RF-11）：进页面就把关联岗位选好。
  const [searchParams] = useSearchParams();
  const linkedJobId = parseLinkedJobId(searchParams.get("job_id"));
  const [sessions, setSessions] = useState<InterviewBrief[]>([]);
  const batch = useBatchSelection<number>();
  const [loadingList, setLoadingList] = useState(true);
  const [active, setActive] = useState<InterviewDetail | null>(null);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [streamingQuestion, setStreamingQuestion] = useState<string | null>(null);
  // 流式中的面试官问题（question_delta 渐进填充）；turn 完成后由 setActive 覆盖。
  const [answer, setAnswer] = useState("");
  const [savingReport, setSavingReport] = useState(false);
  const [activeTab, setActiveTab] = useState("session");
  const [form] = Form.useForm<SetupForm>();
  const endRef = useRef<HTMLDivElement>(null);
  // 历史记录富还原：从「历史题库 / 历史复盘」打开某条记录后，把它传给面板用相同渲染路径展示。
  const [bankRecord, setBankRecord] = useState<QuestionBankRecord | null>(null);
  const [reviewRecord, setReviewRecord] = useState<InterviewReviewRecord | null>(null);

  // 纯取数（不含 setState）：effect 内联调用时 Compiler 才能验证非同步更新；
  // 返回 null 表示失败（错误提示在这里统一给出）。
  const fetchSessions = useCallback(async () => {
    try {
      return await listInterviews();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("interview.toast.loadFailed"));
      return null;
    }
  }, [message]);

  // 事件路径（开始面试/生成后重新打开的整表重拉，含 loading 翻动）。
  const loadList = useCallback(async () => {
    setLoadingList(true);
    const sessions = await fetchSessions();
    if (sessions !== null) setSessions(sessions);
    setLoadingList(false);
  }, [fetchSessions]);

  // Compiler 规范：挂载加载用内联 async IIFE（setState 在自身回调里应用）。
  // 岗位/简历选项此前在这里预拉"前 100 条"当全量（P0-1 已移除）：
  // 各面板与设定卡现在自己走远程搜索 hook，第 101 条之后的历史也能搜到。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sessions = await fetchSessions();
      if (cancelled) return;
      if (sessions !== null) setSessions(sessions);
      setLoadingList(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchSessions]);

  // 新消息进来后滚到底部，用户不用自己找。
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [active?.messages.length, submitting]);

  const start = async (values: SetupForm) => {
    setStarting(true);
    try {
      const session = await createInterview({
        job_id: values.jobId ?? null,
        interview_type: values.interviewType,
        difficulty: values.difficulty,
        interviewer_style: values.interviewerStyle,
        // 「自动」档：何时结束交给 AI（最早第 AUTO_ROUNDS_FLAG 轮起可收尾）；rounds 只是
        // 服务端的硬性保险，界面与提示词都不展示。
        rounds:
          values.rounds === AUTO_ROUNDS_OPTION ? AUTO_FINISH_MAX_ROUNDS : (values.rounds as number),
        rounds_min: values.rounds === AUTO_ROUNDS_OPTION ? AUTO_ROUNDS_FLAG : null,
        focus: values.focus ?? "",
        persona: values.persona ?? "",
      });
      setActive(session);
      setAnswer("");
      await loadList();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("interview.toast.startFailed"));
    } finally {
      setStarting(false);
    }
  };

  const openSession = async (id: number) => {
    try {
      setActive(await getInterview(id));
      setAnswer("");
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("interview.toast.openFailed"));
    }
  };

  const sendAnswer = async () => {
    if (!active || !answer.trim() || submitting) return;
    setSubmitting(true);
    const content = answer.trim();
    setAnswer("");
    setStreamingQuestion("");
    try {
      // 流式：面试官的问题逐字出现（后端把 question 字段明文增量推来）；
      // done 事件的 result 与旧端点同形状，收尾/报告逻辑不变。
      const result = await submitInterviewAnswerStream(active.id, content, (text) => {
        setStreamingQuestion((current) => (current ?? "") + text);
      });
      setActive(result.session);
      if (result.finished) {
        message.success(t("interview.toast.reportReady"));
        await loadList();
      }
    } catch (error) {
      // 回答已经写到服务端了（后端先存后问），所以失败时提示"重试"而不是"重写"。
      message.error(error instanceof Error ? error.message : t("interview.toast.submitFailed"));
      setAnswer(content);
    } finally {
      setStreamingQuestion(null);
      setSubmitting(false);
    }
  };

  const endEarly = () => {
    if (!active) return;
    modal.confirm({
      title: t("interview.confirm.endTitle"),
      content: t("interview.confirm.endBody"),
      okText: t("interview.confirm.endOk"),
      cancelText: t("interview.confirm.endCancel"),
      onOk: async () => {
        setSubmitting(true);
        try {
          setActive(await finishInterview(active.id));
          message.success(t("interview.toast.ended"));
          await loadList();
        } catch (error) {
          message.error(error instanceof Error ? error.message : t("interview.toast.endFailed"));
        } finally {
          setSubmitting(false);
        }
      },
    });
  };

  const remove = async (session: InterviewBrief) => {
    try {
      await deleteInterview(session.id);
      if (active?.id === session.id) setActive(null);
      message.success(t("interview.toast.deleted"));
      await loadList();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("interview.toast.deleteFailed"));
    }
  };

  /** 批量删除：确认后逐条走同一个软删除接口，全部完成再刷新一次。 */
  const removeSelected = () => {
    const ids = [...batch.selectedIds];
    if (ids.length === 0) return;
    modal.confirm({
      title: t("interview.confirm.deleteTitle"),
      content: `这 ${ids.length} 场面试${HARD_DELETE_NOTE}`,
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        const results = await Promise.allSettled(
          sessions
            .filter((item) => batch.isSelected(item.id))
            .map((item) => deleteInterview(item.id)),
        );
        const failed = results.filter((item) => item.status === "rejected").length;
        if (failed === 0) message.success(t("interview.toast.deletedMany", { count: ids.length }));
        else
          message.warning(t("interview.toast.deletedPartial", { ok: ids.length - failed, failed }));
        batch.exitSelecting();
        await loadList();
      },
    });
  };

  const saveReport = async () => {
    if (!active) return;
    setSavingReport(true);
    try {
      await interviewToMaterial(active.id);
      message.success(t("interview.toast.savedToMaterials"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("interview.toast.saveFailed"));
    } finally {
      setSavingReport(false);
    }
  };

  // 题库「开始模拟面试」：把题目带入面试的考察重点，并切回模拟面试页。
  const startFromBank = (questions: string[]) => {
    const focus = questions.slice(0, 6).join(t("interview.listSeparator")).slice(0, 255);
    form.setFieldsValue({ focus });
    setActiveTab("session");
    message.info(t("interview.toast.questionsImported"));
  };

  const answered = active?.answered_rounds ?? 0;
  const finished = active?.status === "finished";

  return (
    <div className="interview-page">
      <div className="profile-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {t("interview.page.title")}
          </Typography.Title>
          <Typography.Text type="secondary">{t("interview.page.subtitle")}</Typography.Text>
        </div>
        {active && (
          <Button icon={<ArrowLeftOutlined />} onClick={() => setActive(null)}>
            {t("interview.action.backToSettings")}
          </Button>
        )}
      </div>

      {!active ? (
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: "session",
              label: t("interview.tab.interview"),
              children: (
                <div className="interview-setup">
                  <SetupTab
                    form={form}
                    initialJobId={linkedJobId}
                    starting={starting}
                    onStart={(values) => void start(values)}
                  />

                  <HistoryCard
                    sessions={sessions}
                    batch={batch}
                    loadingList={loadingList}
                    onOpen={openSession}
                    onRemove={remove}
                    onRemoveSelected={removeSelected}
                  />
                </div>
              ),
            },
            {
              key: "bank",
              label: t("interview.tab.questionBank"),
              children: (
                <QuestionBankPanel
                  onStartSession={startFromBank}
                  record={bankRecord}
                  onOpenRecord={setBankRecord}
                  onCloseRecord={() => setBankRecord(null)}
                />
              ),
            },
            {
              key: "experiences",
              label: t("interview.tab.experiences"),
              children: <InterviewExperiencePanel />,
            },
            {
              key: "review",
              label: t("interview.tab.review"),
              children: (
                <InterviewReviewPanel
                  onGoToResume={() => navigate("/resumes")}
                  record={reviewRecord}
                  onOpenRecord={setReviewRecord}
                  onCloseRecord={() => setReviewRecord(null)}
                />
              ),
            },
          ]}
        />
      ) : (
        <div className="interview-room">
          <div className="interview-room-head">
            <Space size={6} wrap>
              <b>{active.title}</b>
              <Tag color="blue">{active.interview_type}</Tag>
              <Tag>{active.difficulty}</Tag>
              <Tag>{active.interviewer_style}</Tag>
              {active.job_title ? <Tag color="geekblue">{active.job_title}</Tag> : null}
            </Space>
            <Space size={6} wrap>
              <Typography.Text type="secondary">
                {active.rounds_min != null
                  ? t("interview.round.withClosing", {
                      current: Math.min(answered + (finished ? 0 : 1), active.rounds),
                    })
                  : t("interview.round.progress", {
                      current: Math.min(answered + (finished ? 0 : 1), active.rounds),
                      total: active.rounds,
                    })}
              </Typography.Text>
              {!finished && (
                <Button
                  size="small"
                  danger
                  icon={<StopOutlined />}
                  onClick={endEarly}
                  loading={submitting}
                >
                  {t("interview.action.end")}
                </Button>
              )}
              <Button size="small" icon={<ThunderboltOutlined />} onClick={() => setActive(null)}>
                {t("interview.action.new")}
              </Button>
            </Space>
          </div>

          <div className="interview-messages">
            {active.messages.map((item) =>
              item.role === "note" ? (
                <div key={item.id} className="interview-note">
                  {item.content}
                </div>
              ) : (
                <div
                  key={item.id}
                  className={`interview-message interview-message--${item.role === "interviewer" ? "interviewer" : "me"}`}
                >
                  <div className="interview-message-head">
                    {item.role === "interviewer" ? (
                      <img
                        className="jane-avatar"
                        src={JANE_FACE_SOURCES[janeFaceForStyle(active.interviewer_style)]}
                        alt=""
                        aria-hidden="true"
                      />
                    ) : null}
                    <b>{item.role === "interviewer" ? "Jane" : t("interview.role.you")}</b>
                    <Typography.Text type="secondary" className="assistant-message-time">
                      {formatDateTime(item.created_at)}
                    </Typography.Text>
                  </div>
                  <div className="interview-message-body">{item.content}</div>
                  {item.context.feedback ? (
                    <div className="interview-feedback">
                      <b>{t("interview.role.comment")}</b>
                      {item.context.feedback}
                    </div>
                  ) : null}
                </div>
              ),
            )}
            {submitting && !finished ? (
              <div className="interview-message interview-message--interviewer">
                <div className="interview-message-head">
                  <img
                    className="jane-avatar"
                    src={
                      JANE_FACE_SOURCES[streamingQuestion ? "idle" : "thinking"] ??
                      JANE_FACE_SOURCES.thinking
                    }
                    alt=""
                    aria-hidden="true"
                  />
                  <b>Jane</b>
                </div>
                <div className="interview-message-body">
                  {streamingQuestion ? (
                    // 流式：问题文本逐字到达（question_delta），像打字一样出现。
                    <div style={{ whiteSpace: "pre-wrap" }}>{streamingQuestion}</div>
                  ) : (
                    <LoadingBlock tip={t("interview.thinking")} minHeight={120} />
                  )}
                </div>
              </div>
            ) : null}
            <div ref={endRef} />
          </div>

          {finished ? (
            <ReportCard
              session={active}
              onSaveToMaterial={() => void saveReport()}
              saving={savingReport}
            />
          ) : (
            <div className="interview-composer">
              <Input.TextArea
                value={answer}
                autoSize={{ minRows: 3, maxRows: 10 }}
                placeholder={t("interview.placeholder")}
                disabled={submitting}
                onChange={(event) => setAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                    event.preventDefault();
                    void sendAnswer();
                  }
                }}
              />
              <div className="interview-composer-actions">
                <Typography.Text type="secondary">{t("interview.hint.dontKnow")}</Typography.Text>
                <Button
                  type="primary"
                  loading={submitting}
                  disabled={!answer.trim()}
                  onClick={() => void sendAnswer()}
                >
                  {t("interview.action.submit")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
