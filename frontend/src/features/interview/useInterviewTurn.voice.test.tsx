// SPDX-License-Identifier: Apache-2.0
/**
 * 实时语音的一轮：转写结果直接提交，只发布**服务端返回的**面试官回复；不能把转写文本
 * 再当成一条用户消息插进对话。
 *
 * 守的是「不重复说话」：重复插入会让对话里出现两条一样的提问，模型下一轮也会跟着跑偏。
 */
import { App as AntdApp } from "antd";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { InterviewDetail, InterviewMessage } from "../../types";

const api = vi.hoisted(() => ({ submit: vi.fn() }));

vi.mock("../../api/interview", () => ({
  submitInterviewAnswerStream: api.submit,
}));

import { useInterviewTurn } from "./useInterviewTurn";

function session(messages: InterviewMessage[] = []): InterviewDetail {
  return { id: 7, status: "in_progress", messages } as unknown as InterviewDetail;
}

function renderTurn() {
  return renderHook(
    () =>
      useInterviewTurn({
        session: session(),
        onSession: vi.fn(),
        onFinished: vi.fn(),
        onTurnComplete: vi.fn(),
      }),
    { wrapper: ({ children }) => <AntdApp>{children}</AntdApp> },
  );
}

describe("useInterviewTurn realtime voice", () => {
  it("submits transcribed speech directly and publishes only the returned interviewer reply", async () => {
    api.submit.mockResolvedValue({
      session: session([
        { id: 1, role: "user", content: "spoken answer" },
        { id: 2, role: "interviewer", content: "What did you measure?" },
      ] as InterviewMessage[]),
      finished: false,
      needs_report: false,
    });
    const { result } = renderTurn();

    await act(async () => {
      result.current.submitText("spoken answer");
    });

    await waitFor(() =>
      expect(result.current.interviewerReply).toEqual({
        sequence: 1,
        text: "What did you measure?",
      }),
    );
    expect(api.submit).toHaveBeenCalledWith(
      7,
      "spoken answer",
      expect.any(Function),
      undefined,
      expect.any(AbortSignal),
    );
  });
});
