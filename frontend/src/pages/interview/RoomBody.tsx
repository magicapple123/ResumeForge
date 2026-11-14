// SPDX-License-Identifier: Apache-2.0
/**
 * 面试房间主体：头部 + 对话记录 + 三态渲染（报告 / 闸门 / 作答区）。
 *
 * 自 `InterviewPage` 拆出（Q2 加「暂停」）：页面本体原本 496 行、预算 500，
 * 「暂停」要加状态、回调、渲染分支和一条消息列表条件，不先腾行数就一定超。
 * 抽取时**只搬不改**，行为与搬之前逐字一致。
 *
 * 这里刻意只做渲染：所有状态、请求与计时都在页面与各自的 hook 里。暂停态也是这样——
 * 页面给 `paused`，这里只负责把闸门换成「已暂停」卡、把计时读数灰掉。
 */
import type { RefObject } from "react";
import type { InterviewTurn } from "../../features/interview/useInterviewTurn";
import type { InterviewDetail } from "../../types";
import { Composer } from "./Composer";
import { FinishDecisionCard } from "./FinishDecisionCard";
import { FollowUpCard } from "./FollowUpCard";
import { InterviewMessageList } from "./MessageList";
import { ReadyGate } from "./ReadyGate";
import { ReportCard } from "./ReportCard";
import { RoomHeader } from "./RoomHeader";
import "../../styles/modules-interview-room.css";

export function RoomBody({
  session,
  finished,
  answered,
  busy,
  ending,
  awaitingReport,
  hasStarted,
  paused,
  resuming,
  ready,
  timerLabel,
  showTimer,
  savingReport,
  turn,
  endRef,
  followUpRef,
  pauseRef,
  onReady,
  onResume,
  onPause,
  onEndEarly,
  onNew,
  onFinishWithReport,
  onSaveToMaterial,
  onContinueFollowUp,
  onSession,
}: {
  session: InterviewDetail;
  finished: boolean;
  /** 已答轮数（服务端算的）。 */
  answered: number;
  /** 生成中或正在出报告：作答区与其它操作都按忙处理。 */
  busy: boolean;
  /** 正在调 `/finish` 出报告。 */
  ending: boolean;
  /** 正式问答已收尾、报告还没生成：显示决策卡而不是空白报告。 */
  awaitingReport: boolean;
  /**
   * 是否已经开始过（点过「准备好了」、暂停中、答过题或已结束）。
   * 决定对话记录渲不渲染——刚开场就暂停时第一题也不能消失。
   */
  hasStarted: boolean;
  /** 用户主动暂停：计时停住、作答区换成暂停卡。 */
  paused: boolean;
  /** 是否为"离开后又回来"：闸门卡按钮文案与说明改口径。 */
  resuming: boolean;
  /** 已点过「准备好了」且未暂停。 */
  ready: boolean;
  timerLabel: string;
  showTimer: boolean;
  savingReport: boolean;
  turn: InterviewTurn;
  endRef: RefObject<HTMLDivElement | null>;
  followUpRef: RefObject<HTMLDivElement | null>;
  /** 「恢复」时焦点要回到头部的暂停按钮上。 */
  pauseRef: RefObject<HTMLButtonElement | null>;
  onReady: () => void;
  /** 暂停卡上点「继续面试」：必须撤掉 `paused`，与 `onReady` 是两件事（F13）。 */
  onResume: () => void;
  onPause: () => void;
  onEndEarly: () => void;
  onNew: () => void;
  onFinishWithReport: () => void;
  onSaveToMaterial: () => void;
  onContinueFollowUp: () => void;
  /** 追问区回到会话（与页面共用同一个 setActive）。 */
  onSession: (session: InterviewDetail) => void;
}) {
  return (
    <div className="interview-room">
      <RoomHeader
        session={session}
        finished={finished}
        answered={answered}
        submitting={busy}
        timerLabel={timerLabel}
        showTimer={showTimer}
        paused={paused}
        pauseButtonRef={pauseRef}
        onPause={onPause}
        onEndEarly={onEndEarly}
        onNew={onNew}
      />

      {/* 点「准备好了」之前不显示任何对话：这场面试还没开始，面试官也还没开口。
          已经答过题（中途离开又回来）的会话始终显示历史，否则回来会看不到自己说过什么。
          **暂停中也必须显示**：刚开场（0 题）就暂停时把条件写成 `ready` 会把第一题藏掉。 */}
      {hasStarted ? (
        <InterviewMessageList
          /* 只渲染正式问答：追问（#41）自成一段，放在报告下方的 FollowUpCard 里，
             两段记录分开，轮次读数才不会被追问带偏。 */
          messages={session.messages.filter((item) => item.phase !== "followup")}
          interviewerStyle={session.interviewer_style}
          pendingAnswer={turn.pendingAnswer}
          pendingInterrupted={turn.pendingInterrupted}
          retryDisabled={busy}
          onRetry={turn.retry}
          /* 收尾气泡由列表按 `context.closing` 自己判断，页面只报结束状态。 */
          finished={finished}
          thinking={turn.submitting && !finished}
          /* "正在生成报告"只在真的调 /finish 那段时间（ending）成立：答完最后一题后
             不再自动出报告（需求 4），按轮数预测或等 phase 事件都会显示假信息。 */
          finishing={ending}
          streamingQuestion={turn.streamingQuestion}
          endRef={endRef}
        />
      ) : null}

      {finished ? (
        <>
          {/* 正式问答已结束但报告还没生成（需求 4）：先给决策卡，不直接出空白报告。
              刷新恢复也走这条（finished && !hasReport），所以重开一场自动收尾的面试
              不会落到"报告为空"的界面。 */}
          {awaitingReport ? (
            <FinishDecisionCard
              onContinueFollowUp={onContinueFollowUp}
              onFinish={onFinishWithReport}
              finishing={ending}
            />
          ) : (
            <ReportCard
              session={session}
              onSaveToMaterial={onSaveToMaterial}
              saving={savingReport}
            />
          )}
          {/* 追问区在报告生成前后都可用：这正是"先问是否追问，再出报告"的意义。 */}
          <div ref={followUpRef}>
            <FollowUpCard session={session} onSession={onSession} />
          </div>
        </>
      ) : paused ? (
        // 暂停：整块换成闸门卡的「已暂停」态，而不是留一个禁用的输入框。
        // 录音与播报由 Composer 卸载时的 cleanup 释放，所以这里不渲染 Composer。
        <ReadyGate mode="paused" onReady={onReady} onResume={onResume} />
      ) : !ready ? (
        // 还没点「准备好了」：**整块不渲染作答区**（不是禁用）——计时从点下按钮开始，
        // 这之前连输入框都不该出现，否则用户会以为已经在计时了。
        <ReadyGate onReady={onReady} mode={resuming ? "resume" : "start"} />
      ) : (
        <Composer
          value={turn.answer}
          submitting={turn.submitting}
          onChange={turn.setAnswer}
          onSubmit={turn.submit}
          onSubmitText={turn.submitText}
          onStop={turn.stop}
          onPause={onPause}
          onRevise={turn.revise}
          interviewerReply={turn.interviewerReply}
          interviewerStyle={session.interviewer_style}
          messages={session.messages.filter((item) => item.phase !== "followup")}
          pendingAnswer={turn.pendingAnswer}
          streamingQuestion={turn.streamingQuestion}
          sessionId={session.id}
        />
      )}
    </div>
  );
}

export default RoomBody;
