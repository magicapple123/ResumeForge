// SPDX-License-Identifier: Apache-2.0
/** #13A regenerate visibility + #13C steps hint (executed count only, no fake denominator). */
import { App as AntdApp } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AssistantConversationDetail,
  AssistantMessage,
  AssistantToolCall,
} from "../../../types";
import { t } from "../../../i18n";
import AssistantMessageList from "./AssistantMessageList";

function message(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: 1,
    conversation_id: 1,
    role: "assistant",
    content: "answer",
    quoted_message_id: null,
    attachments: [],
    context: {},
    status: "complete",
    error: "",
    model: "test-model",
    created_at: "2026-08-20T10:00:00",
    ...overrides,
  };
}

const DETAIL: AssistantConversationDetail = {
  id: 1,
  title: "conversation",
  surface: "page",
  pinned: false,
  favorite: false,
  archived: false,
  group_name: "",
  message_count: 4,
  created_at: "2026-08-20T10:00:00",
  updated_at: "2026-08-20T10:00:00",
  messages: [
    message({ id: 1, role: "user", content: "first question" }),
    message({ id: 2, role: "assistant", content: "first answer" }),
    message({ id: 3, role: "user", content: "second question" }),
    message({ id: 4, role: "assistant", content: "second answer" }),
  ],
};

function renderList(
  props: {
    sending?: boolean;
    streamingTools?: AssistantToolCall[];
    progressText?: string;
  } = {},
) {
  return render(
    <AntdApp>
      <AssistantMessageList
        detail={DETAIL}
        showLoading={false}
        activeStream
        sending={props.sending ?? false}
        pendingUserText=""
        pendingSentAt="2026-08-20T10:00:00"
        pendingUserAttachments={[]}
        streamingText=""
        streamingReasoning=""
        streamingSources={[]}
        streamingSourceMap={[]}
        streamingTools={props.streamingTools ?? []}
        progressText={props.progressText ?? ""}
        streamError=""
        messageEndRef={createRef<HTMLDivElement>()}
        enabledSkillCount={0}
        skillsLoaded
        onChoosePrompt={vi.fn()}
        onManageSkills={vi.fn()}
        onQuote={vi.fn()}
        onDeleteMessage={vi.fn()}
        onRegenerate={vi.fn()}
        onEnterSelecting={vi.fn()}
        selecting={false}
        selectedIds={new Set<number>()}
        onToggleSelected={vi.fn()}
      />
    </AntdApp>,
  );
}

const TOOL: AssistantToolCall = {
  name: "update_resume_field",
  arguments: { resume_id: 3 },
  args_preview: [{ key: "resume_id", value: "3" }],
  summary: "updated a resume field",
  link: "",
  ok: true,
  error: "",
  changed: true,
};

/** Icon aria-labels prefix the accessible name, so match the translated text as a regex. */
function buttonName(key: Parameters<typeof t>[0]) {
  return new RegExp(t(key));
}

afterEach(() => {
  cleanup();
});

describe("message list #13 wiring", () => {
  it("shows regenerate only on the last assistant answer", () => {
    renderList();
    expect(
      screen.getAllByRole("button", { name: buttonName("assistantUi.messageActions.regenerate") }),
    ).toHaveLength(1);
    // Every message still offers copy, including user messages.
    expect(
      screen.getAllByRole("button", { name: buttonName("assistantUi.messageActions.copy") }),
    ).toHaveLength(4);
  });

  it("disables regenerate while generating", () => {
    renderList({ sending: true });
    expect(
      screen.getByRole("button", { name: buttonName("assistantUi.messageActions.regenerate") }),
    ).toBeDisabled();
  });

  it("steps hint reports executed count and current step, with no fake denominator", () => {
    renderList({ sending: true, streamingTools: [TOOL], progressText: "editing the resume" });
    expect(screen.getByTestId("assistant-steps-hint")).toHaveTextContent(
      t("assistantUi.steps.executed", { count: 1, current: "editing the resume" }),
    );
    // A fake "step 3/7" never exists because there is no plan event.
    expect(screen.queryByText(/\d+\s*\/\s*\d+/)).toBeNull();
  });

  it("falls back to the current tool name when there is no progress text", () => {
    renderList({ sending: true, streamingTools: [TOOL] });
    expect(screen.getByTestId("assistant-steps-hint")).toHaveTextContent(
      t("assistantUi.steps.executed", {
        count: 1,
        current: t("toolLabel.update_resume_field"),
      }),
    );
  });

  it("renders no steps hint without tool calls", () => {
    renderList();
    expect(screen.queryByTestId("assistant-steps-hint")).toBeNull();
  });
});
