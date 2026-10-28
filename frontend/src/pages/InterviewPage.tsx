// SPDX-License-Identifier: Apache-2.0
/**
 * 模拟面试：设定面试官 → 准备好了 → 逐轮问答 → 结束后看评分报告。
 *
 * 与求职助手的差别：这里**流程由代码控制**（轮数、何时结束、什么时候出报告），所以界面上
 * 会明确显示"第 N 轮"，用户始终知道还剩几个问题；助手那边则是自由对话。
 *
 * 0066 起多两件事，都在本文里：
 * - **关联岗位 + 关联简历必选**：面试官只读这两份材料（真实面试的边界），
 *   提交时把 `job_id` / `resume_id` 一起带给后端。
 * - **计时器**：进房间先过 `ReadyGate`（用户点「准备好了」才走表），离开/回来都要重新点
 *   「继续面试」；累计时长上报给服务端，最终报告里会带上它。
 */
import { ArrowLeftOutlined } from "@ant-design/icons";
import { App, Button, Form, Tabs, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  createInterview,
  deleteInterview,
  finishInterview,
  getInterview,
  interviewToMaterial,
  listInterviews,
  updateInterviewDuration,
} from "../api/interview";
import InterviewExperiencePanel from "../components/InterviewExperiencePanel";
import InterviewReviewPanel from "../components/InterviewReviewPanel";
import QuestionBankPanel from "../components/QuestionBankPanel";
import { useBatchSelection } from "../hooks/useBatchSelection";
import { useInterviewTimer } from "../features/interview/useInterviewTimer";
import { useInterviewTurn } from "../features/interview/useInterviewTurn";
import { Composer } from "./interview/Composer";
import { HistoryCard } from "./interview/HistoryCard";
import { InterviewMessageList } from "./interview/MessageList";
import { ReadyGate } from "./interview/ReadyGate";
import { ReportCard } from "./interview/ReportCard";
import { RoomHeader } from "./interview/RoomHeader";
import { SetupForm, SetupTab } from "./interview/SetupTab";
import type {
  InterviewBrief,
  InterviewDetail,
  InterviewReviewRecord,
  QuestionBankRecord,
} from "../types";
import { AUTO_FINISH_MAX_ROUNDS, AUTO_ROUNDS_FLAG } from "../types";
import { AUTO_ROUNDS_OPTION } from "../pages/interview/SetupTab";
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
  // 「结束并出报告」进行中（生成报告要十几秒）：作答区与停止按钮在这段时间里都不该再动。
  const [ending, setEnding] = useState(false);
  // 计时闸门：进房间/重新进房间都要用户主动点一次「准备好了 / 继续面试」。
  const [ready, setReady] = useState(false);
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
  // 依赖里有 `pendingAnswer`：用户刚发的那条是本地气泡，消息数没变但它确实新增了一行。
  // 放在 turn hook 之后是因为依赖直接读它的状态（在这个位置读会踩 TDZ）。

  const activeId = active?.id ?? null;
  const finished = active?.status === "finished";
  const answered = active?.answered_rounds ?? 0;
  // 固定轮数模式：这一答就是最后一答，报告马上要出——不必等后端的 phase 事件，
  // 界面立刻换成「本场面试结束，正在生成报告」。自动收尾模式判不出来，只能等事件。
  const predictingFinish = Boolean(
    active && active.rounds_min == null && answered + 1 >= active.rounds,
  );
  /**
   * 上报累计有效时长（绝对值；服务端取大值）。
   *
   * **静默失败**：计时是辅助信息，上报失败不该打断面试，也不该弹提示把用户从对话里拽出来。
   */
  const persistDuration = useCallback(
    (seconds: number) => {
      if (activeId === null || seconds <= 0) return;
      void updateInterviewDuration(activeId, seconds).catch(() => undefined);
    },
    [activeId],
  );

  // `running` 全由本地状态决定：必须点过「准备好了」、还没结束、且房间里有会话。
  const timer = useInterviewTimer({
    sessionId: activeId,
    initialSeconds: active?.duration_seconds ?? 0,
    running: ready && !finished && activeId !== null,
    onPersist: persistDuration,
  });

  // 一轮问答的状态机（提交 / 逐字流式 / 停止本轮 / 重新回答）在自己的 hook 里：
  // 页面这边只负责"这一轮结束后要做什么"——刷新列表、上报时长。
  const turn = useInterviewTurn({
    session: active,
    onSession: setActive,
    onFinished: async () => {
      message.success(t("interview.toast.reportReady"));
      await loadList();
    },
    onTurnComplete: timer.flush,
  });

  // 「正在生成这一轮」与「正在出报告」对界面是同一件事：作答区与其它操作都该按忙处理。
  const busy = turn.submitting || ending;

  // 新消息进来后滚到底部，用户不用自己找。
  // `pendingAnswer` 进依赖：用户刚发的那条是本地气泡，消息数没变但确实新增了一行。
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [active?.messages.length, turn.submitting, turn.pendingAnswer]);

  /** 退出房间（「回到设置」与「新建面试」共用）：先上报时长，再清掉所有房间状态。 */
  const leaveRoom = () => {
    timer.flush();
    setActive(null);
    setReady(false);
    turn.reset();
  };

  const start = async (values: SetupForm) => {
    setStarting(true);
    try {
      const session = await createInterview({
        // 关联岗位与关联简历都是必选（表单已校验）：面试官只读这两份材料。
        job_id: values.jobId!,
        resume_id: values.resumeId!,
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
      turn.reset();
      // 刚开的面试一律从「准备好了」开始：计时不能从点击「开始面试」就偷偷走。
      setReady(false);
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
      turn.reset();
      // 重新进房间同样要用户点一次「继续面试」才接着计时（离开的那段不该算进时长）。
      setReady(false);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("interview.toast.openFailed"));
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
        setEnding(true);
        // 结束前先把时长存住：报告要带"本次用了多久"，而结束之后计时会停。
        timer.flush();
        try {
          setActive(await finishInterview(active.id));
          message.success(t("interview.toast.ended"));
          await loadList();
        } catch (error) {
          message.error(error instanceof Error ? error.message : t("interview.toast.endFailed"));
        } finally {
          setEnding(false);
        }
      },
    });
  };

  const remove = async (session: InterviewBrief) => {
    try {
      await deleteInterview(session.id);
      if (active?.id === session.id) {
        setActive(null);
        setReady(false);
        turn.reset();
      }
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
      // 条数与硬删除的后果段都进语言包：后果段是共用 key common.note.hardDelete，以 {note} 传入。
      content: t("interview.confirm.deleteBody", {
        count: ids.length,
        note: t("common.note.hardDelete"),
      }),
      okText: t("common.action.delete"),
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
          <Button icon={<ArrowLeftOutlined />} onClick={leaveRoom}>
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
          <RoomHeader
            session={active}
            finished={finished}
            answered={answered}
            submitting={busy}
            timerLabel={timer.label}
            showTimer={ready}
            onEndEarly={endEarly}
            onNew={leaveRoom}
          />

          {/* 点「准备好了」之前不显示任何对话：这场面试还没开始，面试官也还没开口。
              已经答过题（中途离开又回来）的会话始终显示历史，否则回来会看不到自己说过什么。 */}
          {ready || answered > 0 || finished ? (
            <InterviewMessageList
              messages={active.messages}
              interviewerStyle={active.interviewer_style}
              pendingAnswer={turn.pendingAnswer}
              pendingInterrupted={turn.pendingInterrupted}
              retryDisabled={busy}
              onRetry={turn.retry}
              thinking={turn.submitting && !finished}
              finishing={turn.finishing || predictingFinish}
              streamingQuestion={turn.streamingQuestion}
              endRef={endRef}
            />
          ) : null}

          {finished ? (
            <ReportCard
              session={active}
              onSaveToMaterial={() => void saveReport()}
              saving={savingReport}
            />
          ) : !ready ? (
            // 还没点「准备好了」：**整块不渲染作答区**（不是禁用）——计时从点下按钮开始，
            // 这之前连输入框都不该出现，否则用户会以为已经在计时了。
            <ReadyGate
              onReady={() => setReady(true)}
              resuming={timer.seconds > 0 || active.duration_seconds > 0}
            />
          ) : (
            <Composer
              value={turn.answer}
              submitting={turn.submitting}
              onChange={turn.setAnswer}
              onSubmit={turn.submit}
              onStop={turn.stop}
            />
          )}
        </div>
      )}
    </div>
  );
}
