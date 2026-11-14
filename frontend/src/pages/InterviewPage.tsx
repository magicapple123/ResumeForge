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
import InterviewExperiencePanel from "../features/interview/InterviewExperiencePanel";
import InterviewReviewPanel from "../features/interview/InterviewReviewPanel";
import QuestionBankPanel from "../features/questionbank/QuestionBankPanel";
import { useQuestionBankInterview } from "../features/questionbank/useQuestionBankInterview";
import { useBatchSelection } from "../hooks/useBatchSelection";
import { toInternalResumeId, toMaterialPayload } from "../features/interview/materialPayload";
import { useInterviewTimer } from "../features/interview/useInterviewTimer";
import { hasInterviewReport, useInterviewTurn } from "../features/interview/useInterviewTurn";
import { RoomBody } from "./interview/RoomBody";
import { HistoryCard } from "./interview/HistoryCard";
import { SetupForm, SetupTab } from "./interview/SetupTab";
import type {
  InterviewBrief,
  InterviewDetail,
  InterviewReviewRecord,
  QuestionBankRecord,
} from "../types";
import { AUTO_FINISH_MAX_ROUNDS, AUTO_ROUNDS_FLAG } from "../types";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import { parseLinkedJobId } from "../features/interview/parseLinkedJobId";
import type { MessageKey } from "../i18n";

/**
 * 页头副标题按 tab 分开（Q3）：四个 tab 是四件不同的事，共用一句"让 AI 面试官提问"
 * 会让题库 / 面经 / 复盘三个 tab 的头图都在说别处的功能。
 */
const SUBTITLE_KEYS: Record<string, MessageKey> = {
  session: "interview.page.subtitle.session",
  bank: "interview.page.subtitle.bank",
  experiences: "interview.page.subtitle.experiences",
  review: "interview.page.subtitle.review",
};

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
  // 面试中主动暂停（Q2）：与 `ready` 分开，因为"没开始"和"暂停中"对用户是两件事
  // （前者是闸门卡「准备好了」，后者是「面试已暂停」+ 计时灰化）。
  const [paused, setPaused] = useState(false);
  // 「恢复」时焦点回到头部的暂停按钮上（Q2 第 9 条）。
  const pauseRef = useRef<HTMLButtonElement>(null);
  const [savingReport, setSavingReport] = useState(false);
  const [activeTab, setActiveTab] = useState("session");
  const [form] = Form.useForm<SetupForm>();
  const bankInterview = useQuestionBankInterview(form, setActiveTab);
  const endRef = useRef<HTMLDivElement>(null);
  // 追问区的定位锚点：决策卡的「继续追问」要把焦点送到这里的输入框。
  const followUpRef = useRef<HTMLDivElement>(null);
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
  // 报告有没有生成是**另一件事**（需求 4）：自动收尾只收盘，报告等用户在决策卡上确认。
  const hasReport = hasInterviewReport(active);

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

  // `running` 全由本地状态决定：必须点过「准备好了」、**没有暂停**、还没结束、且房间里有会话。
  // 暂停走的是同一个开关（停表 + 按绝对值上报），只是入口是一个显式按钮而不是离开房间。
  const timer = useInterviewTimer({
    sessionId: activeId,
    initialSeconds: active?.duration_seconds ?? 0,
    running: ready && !paused && !finished && activeId !== null,
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
  /**
   * 等用户决定要不要出报告：`turn.awaitingReport` 是刚走完这一轮，`finished && !hasReport`
   * 覆盖**刷新恢复**——重开一场已收盘但没报告的面试，必须仍显示决策卡而不是空白报告。
   */
  const awaitingReport = turn.awaitingReport || (finished && !hasReport);

  // 新消息进来后滚到底部；`pendingAnswer` 进依赖：刚发的那条是本地气泡，消息数没变但多了一行。
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [active?.messages.length, turn.submitting, turn.pendingAnswer]);

  /** 退出房间（「回到设置」与「新建面试」共用）：先上报时长，再清掉所有房间状态。 */
  const leaveRoom = () => {
    timer.flush();
    setActive(null);
    setReady(false);
    setPaused(false);
    turn.reset();
  };

  /**
   * 暂停（Q2）：生成中就先把这一轮停掉——复用既有的 `turn.stop()`（abort 当前流、服务端
   * 标 interrupted、已生成内容保留可重答），**不新写一套中止逻辑**。
   *
   * 时长在这里显式 flush 一次：`running` 由 true 变 false 时计时器自己也会报一次，
   * 绝对值语义下重复上报无害，但显式那一次让"暂停那一刻"的读数一定被记住。
   */
  const pause = () => {
    if (paused || finished) return;
    if (turn.submitting) turn.stop();
    timer.flush();
    setPaused(true);
  };

  /** 恢复：只撤暂停标记，**麦克风不自动重开**（安全优先），焦点回到暂停按钮。 */
  const resume = () => {
    setPaused(false);
    // 等按钮从「继续」换回「暂停」的图标后再聚焦，否则焦点会落在即将被替换的节点上。
    requestAnimationFrame(() => pauseRef.current?.focus());
  };

  const togglePause = () => {
    if (paused) resume();
    else pause();
  };

  const start = async (values: SetupForm) => {
    setStarting(true);
    try {
      // 每一侧材料都是"从记录选 / 导入文件"二选一（#41）：给了文件就不再传 id。
      // 材料一律走 `toMaterialPayload` 投影（问题 5）：上传接口的返回值带 `warnings`，
      // 而写端点 `extra="forbid"`，整份回传会让两侧各报一条「包含不支持的字段」。
      const session = await createInterview({
        job_id: values.jobMaterial ? undefined : values.jobId!,
        // 关联简历的值带前缀（#25）：`r:12` 才是内部 id，`e:7`（外部简历）没有内部 id。
        resume_id: values.resumeMaterial ? undefined : toInternalResumeId(values.resumeId),
        job_material: toMaterialPayload(values.jobMaterial),
        resume_material: toMaterialPayload(values.resumeMaterial),
        interview_type: values.interviewType,
        difficulty: values.difficulty,
        interviewer_style: values.interviewerStyle,
        // 轮数按 `roundsMode` 分流（问题 05）。「自动」档：何时结束交给 AI（最早第
        // AUTO_ROUNDS_FLAG 轮起可收尾），rounds 只是服务端的硬性保险，界面与提示词都不展示。
        rounds: values.roundsMode === "auto" ? AUTO_FINISH_MAX_ROUNDS : values.rounds,
        rounds_min: values.roundsMode === "auto" ? AUTO_ROUNDS_FLAG : null,
        focus: values.focus ?? "",
        persona: values.persona ?? "",
      });
      setActive(session);
      turn.reset();
      // 刚开的面试一律从「准备好了」开始：计时不能从点击「开始面试」就偷偷走。
      setReady(false);
      setPaused(false);
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
      setPaused(false);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("interview.toast.openFailed"));
    }
  };

  /** 决策卡的「继续追问」：把视线与焦点送到下方的追问输入区（此时追问已可用，不发请求）。 */
  const goToFollowUp = () => {
    const node = followUpRef.current;
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
    node.querySelector("input")?.focus();
  };

  /** 决策卡上点「结束并生成报告」：调 /finish，报告回来后页面自然切到报告卡 + 追问区。 */
  const finishWithReport = async () => {
    if (!active || ending) return;
    setEnding(true);
    // 报告要带"本次用了多久"，而结束之后计时会停——先把时长存住。
    timer.flush();
    try {
      setActive(await finishInterview(active.id));
      // 报告已经有了，决策卡必须让位；不清掉这面旗会一直挂在报告卡上面。
      turn.clearAwaitingReport();
      message.success(t("interview.toast.reportReady"));
      await loadList();
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("interviewPage.decision.failed"));
    } finally {
      setEnding(false);
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
        setPaused(false);
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

  return (
    <div className="interview-page">
      <div className="profile-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {t("interview.page.title")}
          </Typography.Title>
          <Typography.Text type="secondary">{t(SUBTITLE_KEYS[activeTab])}</Typography.Text>
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
                    initialResumeMaterial={bankInterview.materials.resumeMaterial}
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
                  onStartSession={bankInterview.startFromBank}
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
        <RoomBody
          session={active}
          finished={finished}
          answered={answered}
          busy={busy}
          ending={ending}
          awaitingReport={awaitingReport}
          // 「开过表就显示」：暂停中也要显示对话记录（刚开场 0 题暂停时第一题不能消失）。
          hasStarted={ready || paused || answered > 0 || finished}
          paused={paused}
          resuming={timer.seconds > 0 || active.duration_seconds > 0}
          ready={ready}
          timerLabel={timer.label}
          // 计时器常显：只要开过表（答过题 / 暂停中 / 正在走表）就有读数。
          showTimer={ready || paused || answered > 0}
          savingReport={savingReport}
          turn={turn}
          endRef={endRef}
          followUpRef={followUpRef}
          pauseRef={pauseRef}
          onReady={() => setReady(true)}
          // 暂停卡（F13）：先撤暂停再置 ready。正常暂停时 ready 已是 true，`setReady(true)`
          // 会被 React 同值 bail out，所以**必须**调 `resume()`，否则暂停态永远停住。
          // 极端情况（0 题就暂停）ready 还是 false，这里一并置上，避免恢复后再弹一次闸门。
          onResume={() => {
            setReady(true);
            resume();
          }}
          onPause={togglePause}
          onEndEarly={endEarly}
          onNew={leaveRoom}
          onFinishWithReport={() => void finishWithReport()}
          onSaveToMaterial={() => void saveReport()}
          onContinueFollowUp={goToFollowUp}
          onSession={setActive}
        />
      )}
    </div>
  );
}
