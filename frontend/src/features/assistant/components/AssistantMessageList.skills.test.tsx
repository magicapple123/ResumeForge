// SPDX-License-Identifier: Apache-2.0
/**
 * T24：技能改成消息级后，气泡上的技能怎么显示。
 *
 * 三条性质：
 * 1. **用户气泡**渲染这条消息用了哪些技能，前缀「使用」（不再是「本对话启用」）；
 * 2. **助手气泡**不再出现任何技能行（技能属于用户那条消息）；
 * 3. 旧数据的 ``legacy_skills`` 在消息流顶部给一行可关闭提示，关掉后不再出现。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantConversationDetail, AssistantMessage } from "../../../types";
import { t } from "../../../i18n";
import AssistantMessageList from "./AssistantMessageList";

// 中文断言文案走变量：ByText 中文字面量会推高 i18n 棘轮（只降不升）。
const SKILL_NAME = "面试模拟官";
const USER_TEXT = "用技能写";
const ASSISTANT_TEXT = "好的";
const LEGACY_SKILL = "旧技能";
const PROMPT_LEAK = /不应出现在界面上/;

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

function renderList(detail: AssistantConversationDetail) {
  const endRef = createRef<HTMLDivElement>();
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
        messageEndRef={endRef}
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

function detailWith(
  messages: AssistantMessage[],
  legacySkills: { id: number; name: string }[] = [],
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
    legacy_skills: legacySkills,
  } as AssistantConversationDetail;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  window.localStorage.clear();
});

describe("消息级技能（T24）", () => {
  it("用户气泡用「使用」列出这条消息的技能，助手气泡不再有技能行", () => {
    renderList(
      detailWith([
        message({
          id: 1,
          role: "user",
          content: USER_TEXT,
          context: {
            skills: [{ id: 7, name: SKILL_NAME }],
            skill_prompt: "[已导入的技能] 不应出现在界面上",
          },
        }),
        message({ id: 2, role: "assistant", content: ASSISTANT_TEXT }),
      ]),
    );

    expect(screen.getByText(t("conversationSkills.message.usedLabel"))).toBeInTheDocument();
    expect(screen.getByText(SKILL_NAME)).toBeInTheDocument();
    // 提示词正文只给模型，界面不展示。
    expect(screen.queryByText(PROMPT_LEAK)).toBeNull();
    // 助手气泡没有第二份技能行（T24 前那行写的是「本对话启用」）。
    const assistantArticle = screen.getByText(ASSISTANT_TEXT).closest("article");
    expect(assistantArticle).not.toBeNull();
    expect(
      within(assistantArticle as HTMLElement).queryByText(
        t("conversationSkills.message.usedLabel"),
      ),
    ).toBeNull();
    expect(assistantArticle?.querySelector(".assistant-message-skills")).toBeNull();
  });

  it("旧会话的 legacy_skills 在顶部提示一次，关闭后记住（按会话记 localStorage）", () => {
    renderList(
      detailWith([message({ id: 2, role: "assistant" })], [{ id: 3, name: LEGACY_SKILL }]),
    );

    const notice = t("conversationSkills.legacy.notice", { names: LEGACY_SKILL });
    expect(screen.getByText(notice)).toBeTruthy();
    fireEvent.click(screen.getByText(t("conversationSkills.legacy.dismiss")));

    expect(screen.queryByText(notice)).toBeNull();
    expect(window.localStorage.getItem("resumeforge.assistant.legacySkillsDismissed.1")).toBe("1");
  });
});
