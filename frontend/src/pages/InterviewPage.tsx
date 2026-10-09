/**
 * 模拟面试：设定面试官 → 逐轮问答 → 结束后看评分报告。
 *
 * 与求职助手的差别：这里**流程由代码控制**（轮数、何时结束、什么时候出报告），所以界面上
 * 会明确显示"第 N/6 轮"，用户始终知道还剩几个问题；助手那边则是自由对话。
 */
import { ArrowLeftOutlined, StopOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Modal, Space, Tabs, Tag, Typography } from "antd";
import LoadingBlock from "../components/common/LoadingBlock";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createInterview,
  deleteInterview,
  finishInterview,
  getInterview,
  interviewToMaterial,
  listInterviews,
  submitInterviewAnswer,
} from "../api/interview";
import { listJobs } from "../api/jobs";
import { listResumes } from "../api/resumes";
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
import { formatDateTime } from "../utils/format";

export default function InterviewPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<InterviewBrief[]>([]);
  const batch = useBatchSelection<number>();
  const [loadingList, setLoadingList] = useState(true);
  const [active, setActive] = useState<InterviewDetail | null>(null);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [answer, setAnswer] = useState("");
  const [savingReport, setSavingReport] = useState(false);
  const [jobOptions, setJobOptions] = useState<{ value: number; label: string }[]>([]);
  const [resumeOptions, setResumeOptions] = useState<{ value: number; label: string }[]>([]);
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
      message.error(error instanceof Error ? error.message : "读取面试记录失败");
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

  // Compiler 规范：挂载加载用内联 async IIFE（setState 在自身回调里应用）；
  // 选项列表的两个请求本就是 .then 回调形状，保持不变。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sessions = await fetchSessions();
      if (cancelled) return;
      if (sessions !== null) setSessions(sessions);
      setLoadingList(false);
    })();
    listJobs({ page_size: 100 })
      .then((page) => {
        if (cancelled) return;
        setJobOptions(
          page.items.map((job) => ({
            value: job.id,
            label: `${job.title}${job.company ? ` · ${job.company}` : ""}`,
          })),
        );
      })
      .catch(() => setJobOptions([]));
    listResumes({ page_size: 100 })
      .then((page) => {
        if (cancelled) return;
        setResumeOptions(
          page.items.map((resume) => ({
            value: resume.id,
            label: resume.title || `简历 #${resume.id}`,
          })),
        );
      })
      .catch(() => setResumeOptions([]));
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
        rounds: values.rounds,
        focus: values.focus ?? "",
        persona: values.persona ?? "",
      });
      setActive(session);
      setAnswer("");
      await loadList();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "开始面试失败");
    } finally {
      setStarting(false);
    }
  };

  const openSession = async (id: number) => {
    try {
      setActive(await getInterview(id));
      setAnswer("");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "打开面试失败");
    }
  };

  const sendAnswer = async () => {
    if (!active || !answer.trim() || submitting) return;
    setSubmitting(true);
    const content = answer.trim();
    setAnswer("");
    try {
      const result = await submitInterviewAnswer(active.id, content);
      setActive(result.session);
      if (result.finished) {
        message.success("面试结束，评分报告已生成");
        await loadList();
      }
    } catch (error) {
      // 回答已经写到服务端了（后端先存后问），所以失败时提示"重试"而不是"重写"。
      message.error(error instanceof Error ? error.message : "提交回答失败，请重试");
      setAnswer(content);
    } finally {
      setSubmitting(false);
    }
  };

  const endEarly = () => {
    if (!active) return;
    Modal.confirm({
      title: "结束这场面试？",
      content: "结束后会根据已有的问答生成评分报告，不能再补充回答。",
      okText: "结束并出报告",
      cancelText: "继续面试",
      onOk: async () => {
        setSubmitting(true);
        try {
          setActive(await finishInterview(active.id));
          message.success("面试已结束");
          await loadList();
        } catch (error) {
          message.error(error instanceof Error ? error.message : "结束面试失败");
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
      message.success("已删除这场面试");
      await loadList();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除失败");
    }
  };

  /** 批量删除：确认后逐条走同一个软删除接口，全部完成再刷新一次。 */
  const removeSelected = () => {
    const ids = [...batch.selectedIds];
    if (ids.length === 0) return;
    Modal.confirm({
      title: `删除选中的 ${ids.length} 场面试？`,
      content: "删除后可在回收站找回。",
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        const results = await Promise.allSettled(
          sessions
            .filter((item) => batch.isSelected(item.id))
            .map((item) => deleteInterview(item.id)),
        );
        const failed = results.filter((item) => item.status === "rejected").length;
        if (failed === 0) message.success(`已删除 ${ids.length} 场面试`);
        else message.warning(`已删除 ${ids.length - failed} 场，${failed} 场失败，请重试`);
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
      message.success("已存进资料箱的「面试复盘」分类");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "存进资料箱失败");
    } finally {
      setSavingReport(false);
    }
  };

  // 题库「开始模拟面试」：把题目带入面试的考察重点，并切回模拟面试页。
  const startFromBank = (questions: string[]) => {
    const focus = questions.slice(0, 6).join("；").slice(0, 255);
    form.setFieldsValue({ focus });
    setActiveTab("session");
    message.info("题目已带入「考察重点」，调整后即可开始面试");
  };

  const answered = active?.answered_rounds ?? 0;
  const finished = active?.status === "finished";

  return (
    <div className="interview-page">
      <div className="profile-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            模拟面试
          </Typography.Title>
          <Typography.Text type="secondary">
            让 AI 面试官按你设定的类型与难度提问，结束后给出评分报告与改进建议。
          </Typography.Text>
        </div>
        {active && (
          <Button icon={<ArrowLeftOutlined />} onClick={() => setActive(null)}>
            回到设置
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
              label: "模拟面试",
              children: (
                <div className="interview-setup">
                  <SetupTab
                    form={form}
                    jobOptions={jobOptions}
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
              label: "题库",
              children: (
                <QuestionBankPanel
                  jobOptions={jobOptions}
                  resumeOptions={resumeOptions}
                  onStartSession={startFromBank}
                  record={bankRecord}
                  onOpenRecord={setBankRecord}
                  onCloseRecord={() => setBankRecord(null)}
                />
              ),
            },
            {
              key: "experiences",
              label: "面经",
              children: <InterviewExperiencePanel jobOptions={jobOptions} />,
            },
            {
              key: "review",
              label: "面试复盘",
              children: (
                <InterviewReviewPanel
                  jobOptions={jobOptions}
                  resumeOptions={resumeOptions}
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
                第 {Math.min(answered + (finished ? 0 : 1), active.rounds)} / {active.rounds} 轮
              </Typography.Text>
              {!finished && (
                <Button
                  size="small"
                  danger
                  icon={<StopOutlined />}
                  onClick={endEarly}
                  loading={submitting}
                >
                  结束并出报告
                </Button>
              )}
              <Button size="small" icon={<ThunderboltOutlined />} onClick={() => setActive(null)}>
                新开一场
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
                    <b>{item.role === "interviewer" ? "Jane" : "我"}</b>
                    <Typography.Text type="secondary" className="assistant-message-time">
                      {formatDateTime(item.created_at)}
                    </Typography.Text>
                  </div>
                  <div className="interview-message-body">{item.content}</div>
                  {item.context.feedback ? (
                    <div className="interview-feedback">
                      <b>面试官点评：</b>
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
                    src={JANE_FACE_SOURCES.thinking}
                    alt=""
                    aria-hidden="true"
                  />
                  <b>Jane</b>
                </div>
                <div className="interview-message-body">
                  <LoadingBlock tip="正在思考下一个问题…" minHeight={120} />
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
                placeholder="像真实面试那样回答：先说结论，再说做了什么、结果如何（Ctrl+Enter 发送）"
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
                <Typography.Text type="secondary">
                  答不上来可以直接说「不知道」，面试官会给回答思路。
                </Typography.Text>
                <Button
                  type="primary"
                  loading={submitting}
                  disabled={!answer.trim()}
                  onClick={() => void sendAnswer()}
                >
                  提交回答
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
