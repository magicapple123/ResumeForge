// SPDX-License-Identifier: Apache-2.0
/**
 * 一轮问答的提交状态机（T04-c 自 InterviewPage 抽出）。
 *
 * 抽出来的理由是这一段同时管着四件事，都贴着"回答有没有送到、面试官有没有接话"：
 *
 * 1. **先上屏**：用户那句话要立刻出现在对话里，不能只留一个"正在思考"；
 * 2. **流式**：面试官的问题逐字到达（``question_delta``）；
 * 3. **停止本轮**：生成中点一下就 abort，页面立刻回到可提问状态——服务端随即停下并把这
 *    一轮标成 ``interrupted``（用户那条回答不删，可以重答）；
 * 4. **重新回答**：``interrupted`` 的那一轮可以再提交一次，走的是同一条提问链路，服务端
 *    会复用那条回答，不会写出第二条一模一样的用户消息。
 *
 * 页面那边只剩渲染与"这一轮结束后要做什么"（刷新列表、上报时长）。
 */
import { useRef, useState } from "react";
import { App } from "antd";
import { submitInterviewAnswerStream } from "../../api/interview";
import type { InterviewDetail } from "../../types";
import { t } from "../../i18n";
import { isAbortError } from "../../hooks/useAbortableRequest";

/**
 * 这个错误是不是"用户自己按了停止"。
 *
 * abort 之后 ``fetch`` 抛的是 ``AbortError``——它不是失败：不能弹错误提示，也不能把内容
 * 塞回输入框（那等于告诉用户"没提交成功"，其实回答早就落库了）。
 *
 * 判定实现统一在 `hooks/useAbortableRequest.ts` 的 `isAbortError`（T04-d）：流式端点抛原生
 * `AbortError`，`request()` 的普通端点抛 `ApiError(code="cancelled")`，两处必须同一套口径，
 * 否则"停止"在一类请求上报错、在另一类上静默。这里保留原名字，调用方不必改动。
 */
export function isAborted(error: unknown): boolean {
  return isAbortError(error);
}

/**
 * 这场面试有没有报告。
 *
 * 后端"空报告"是 ``{}``（``InterviewDetail.report`` 的默认值），所以不能只判真值——
 * 空对象在 JS 里是真的，会把"还没生成"误判成"已经有报告"。
 */
export function hasInterviewReport(session: InterviewDetail | null | undefined): boolean {
  return Boolean(session && Object.keys(session.report ?? {}).length > 0);
}

export interface InterviewTurn {
  /** 输入框里的文字（受控）。 */
  answer: string;
  /** 这一轮还在生成：输入框禁用、按钮换成「停止本轮」。 */
  submitting: boolean;
  /** 流式中的面试官问题（渐进填充）；没在流式时为空。 */
  streamingQuestion: string | null;
  /** 已提交、服务端还没回包的本地占位回答。 */
  pendingAnswer: string | null;
  /** 本地这条占位回答是被「停止本轮」掐断的。 */
  pendingInterrupted: boolean;
  /**
   * 正式问答已收尾、报告还没生成：**等用户决定**（继续追问 / 结束并生成报告）。
   * 与"正在出报告"是两件事——那一段由页面在调用 ``/finish`` 期间显示。
   * 被判为真时追问输入区立刻可用，对话区末尾显示决策卡。
   */
  awaitingReport: boolean;
  /** 用户放弃决策（重新开始 / 离开房间）时清掉等待态。 */
  clearAwaitingReport: () => void;
  setAnswer: (value: string) => void;
  /** 提交输入框里的回答。 */
  submit: () => void;
  /** 停止本轮：abort 当前请求，页面立刻回到可提问状态。 */
  stop: () => void;
  /** 重新回答某一轮（服务端历史里的 interrupted，或本地刚停下的那一轮）。 */
  retry: (content: string) => void;
  /** 换会话 / 离开房间时清空所有回合状态。 */
  reset: () => void;
}

export function useInterviewTurn({
  session,
  onSession,
  onFinished,
  onTurnComplete,
}: {
  /** 当前正在进行的面试；离开房间后为 null。 */
  session: InterviewDetail | null;
  /** 一轮的结果（服务端带回的完整会话）。 */
  onSession: (detail: InterviewDetail) => void;
  /** 这一轮直接出完了报告（面试结束）。 */
  onFinished: () => void | Promise<void>;
  /** 这一轮正常走完：页面借此上报累计时长。 */
  onTurnComplete: () => void;
}): InterviewTurn {
  const { message } = App.useApp();
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [streamingQuestion, setStreamingQuestion] = useState<string | null>(null);
  const [pendingAnswer, setPendingAnswer] = useState<string | null>(null);
  const [pendingInterrupted, setPendingInterrupted] = useState(false);
  const [awaitingReport, setAwaitingReport] = useState(false);
  // 正在跑的这一轮请求：abort 即断开连接 → 服务端停下并标记 interrupted。
  const abortRef = useRef<AbortController | null>(null);

  /** 把一段回答交给流式提问链路；「提交」与「重新回答」共用它。 */
  const submitContent = async (content: string) => {
    if (!session || !content.trim() || submitting) return;
    const text = content.trim();
    const sessionId = session.id;
    setSubmitting(true);
    setAnswer("");
    // **先**把用户这句话放上屏：服务端要等模型答完才回包，否则界面只剩「正在思考」。
    setPendingAnswer(text);
    setPendingInterrupted(false);
    setStreamingQuestion("");
    const controller = new AbortController();
    abortRef.current = controller;
    let succeeded = false;
    try {
      // 流式：面试官的问题逐字出现（后端把 question 字段明文增量推来）；
      // done 事件的 result 与旧端点同形状，收尾/报告逻辑不变。
      const result = await submitInterviewAnswerStream(
        sessionId,
        text,
        (delta) => setStreamingQuestion((current) => (current ?? "") + delta),
        // 不再有 phase 回调：需求 4 之后收尾只收盘，服务端不再推 ``finishing``
        // （"正在生成报告"由页面在调用 /finish 期间显示）。
        undefined,
        controller.signal,
      );
      succeeded = true;
      onSession(result.session);
      // 收尾与出报告已拆开（需求 4）：``finished`` 只表示正式问答结束。报告还没生成时
      // 切到"等用户决定"，**不能**当成"报告已就绪"（那会弹一句没发生的成功提示）。
      // 旧后端不带这个字段，于是退回看会话本身：已结束且没有报告，同样是等待态。
      const needsReport =
        result.needs_report ??
        (result.session.status === "finished" && !hasInterviewReport(result.session));
      setAwaitingReport(needsReport);
      if (result.finished && !needsReport) await onFinished();
    } catch (error) {
      if (isAborted(error)) {
        // 用户自己停了这一轮：**不是失败**——不弹错误、不把内容塞回输入框。服务端已经把
        // 这条回答标成 interrupted（数据保留），界面上换成"上次没答完 + 重新回答"。
        setPendingInterrupted(true);
      } else {
        // 回答已经写到服务端了（后端先存后问），所以失败时提示"重试"而不是"重写"。
        message.error(error instanceof Error ? error.message : t("interview.toast.submitFailed"));
        setAnswer(text);
      }
    } finally {
      abortRef.current = null;
      // 成功时服务端已经带回这条消息：清掉本地占位气泡，避免同一句话出现两次。
      // 失败/中断时**保留**它——后端已存档，用户看到自己说过什么才好接着重试。
      if (succeeded) {
        setPendingAnswer(null);
        setPendingInterrupted(false);
        onTurnComplete();
      }
      setStreamingQuestion(null);
      setSubmitting(false);
    }
  };

  const submit = () => {
    if (!answer.trim()) return;
    void submitContent(answer);
  };

  /**
   * 停止本轮：abort 掉正在跑的那一轮。
   *
   * 断开连接就是"取消"——服务端不再继续烧 token，并把这一轮标成 interrupted（用户那条
   * 回答**不删**）。页面在 catch 里回到可继续提问的状态。
   */
  const stop = () => {
    abortRef.current?.abort();
  };

  /** 重新回答某一轮：走原来的提问链路（不新建端点）。 */
  const retry = (content: string) => {
    if (submitting) return;
    void submitContent(content);
  };

  const reset = () => {
    setAnswer("");
    setPendingAnswer(null);
    setPendingInterrupted(false);
    setStreamingQuestion(null);
    setAwaitingReport(false);
  };

  return {
    answer,
    submitting,
    streamingQuestion,
    pendingAnswer,
    pendingInterrupted,
    awaitingReport,
    clearAwaitingReport: () => setAwaitingReport(false),
    setAnswer,
    submit,
    stop,
    retry,
    reset,
  };
}
