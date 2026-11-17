// SPDX-License-Identifier: Apache-2.0
/**
 * T25：压缩边界与记忆引用在消息流里的位置。
 *
 * 三条性质：
 * 1. 边界插在 `covered_until_message_id` 那条消息**下方**（不是上方）；
 * 2. 分页把锚点挤出已加载范围时退化到列表顶部，文案改成「更早的若干轮」；
 * 3. T23 的「参考了 N 条记忆」只出现在助手气泡，展开后能看到内容快照。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantConversationDetail, AssistantMessage } from "../../../types";
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

function detailWith(
  messages: AssistantMessage[],
  compaction: AssistantConversationDetail["compaction"] = null,
) {
  return {
    id: 1,
    title: "conversation",
    surface: "page",
    pinned: false,
    favorite: false,
    archived: false,
    group_name: "",
    message_count: messages.length,
    created_at: "2026-08-20T10:00:00",
    updated_at: "2026-08-20T10:00:00",
    messages,
    compaction,
  } as AssistantConversationDetail;
}

function renderList(detail: AssistantConversationDetail) {
  return render(
    <AntdApp>
      <AssistantMessageList
        detail={detail}
        showLoading={false}
        activeStream={false}
        sending={false}
        pendingUserText=""
        pendingSentAt="2026-08-20T10:00:00"
        pendingUserAttachments={[]}
        streamingText=""
        streamingReasoning=""
        streamingSources={[]}
        streamingSourceMap={[]}
        streamingTools={[]}
        progressText=""
        streamError=""
        messageEndRef={createRef<HTMLDivElement>()}
        enabledSkillCount={0}
        skillsLoaded
        onChoosePrompt={vi.fn()}
        onManageSkills={vi.fn()}
        onQuote={vi.fn()}
        onDeleteMessage={vi.fn()}
        onEnterSelecting={vi.fn()}
        selecting={false}
        selectedIds={new Set()}
        onToggleSelected={vi.fn()}
      />
    </AntdApp>,
  );
}

const SUMMARY_GOAL = "Goal: find backend roles";
const LATEST_TEXT = "latest message";
const MEMORY_VALUE = "Hangzhou";

const COMPACTION = {
  covered_until_message_id: 2,
  turns: 4,
  tokens_before: 900,
  tokens_after: 300,
  model: "test-model",
  created_at: "2026-08-20T10:00:00",
  masked_tool_results: 0,
  summary: SUMMARY_GOAL,
};

afterEach(() => cleanup());

describe("compaction boundary (T25)", () => {
  it("places the boundary right after the anchor message", () => {
    const anchorText = "last covered message";
    renderList(
      detailWith(
        [
          message({ id: 1, role: "user", content: "start" }),
          message({ id: 2, role: "assistant", content: anchorText }),
          message({ id: 3, role: "user", content: "continue" }),
        ],
        COMPACTION,
      ),
    );

    const boundary = screen.getByTestId("assistant-compaction-boundary");
    const anchorArticle = screen.getByText(anchorText).closest("article");
    expect(anchorArticle).not.toBeNull();
    // 下一条兄弟就是边界：插在消息之后，而不是之前。
    expect(boundary.previousElementSibling).toBe(anchorArticle);
    expect(
      screen.getByText(t("contextUsage.compaction.boundary.line", { turns: 4, tokens: 600 })),
    ).toBeInTheDocument();
  });

  it("falls back to the top of the list when the anchor is not loaded", () => {
    renderList(
      detailWith([message({ id: 9, role: "user", content: LATEST_TEXT })], {
        ...COMPACTION,
        covered_until_message_id: 2,
      }),
    );

    expect(
      screen.getByText(t("contextUsage.compaction.boundary.earlier", { tokens: 600 })),
    ).toBeInTheDocument();
    const boundary = screen.getByTestId("assistant-compaction-boundary");
    // 退化的边界在消息列表之前（列表头之后的第一块）。
    expect(boundary.compareDocumentPosition(screen.getByText(LATEST_TEXT))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("expands the same summary text", () => {
    renderList(detailWith([message({ id: 2, role: "assistant", content: "ok" })], COMPACTION));

    expect(screen.queryByText(SUMMARY_GOAL)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: t("contextUsage.compaction.boundary.view") }),
    );
    expect(screen.getByText(SUMMARY_GOAL)).toBeInTheDocument();
  });
});

describe("memory references (T23)", () => {
  it("lists the memories an assistant message used, collapsed by default", () => {
    renderList(
      detailWith([
        message({
          id: 2,
          role: "assistant",
          content: "ok",
          context: { memories: [{ id: 5, kind: "city", value: MEMORY_VALUE }] },
        }),
      ]),
    );

    const toggle = screen.getByRole("button", {
      name: t("assistantUi.messageList.memory.used", { count: 1 }),
    });
    expect(screen.queryByText(MEMORY_VALUE)).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText(MEMORY_VALUE)).toBeInTheDocument();
  });
});
