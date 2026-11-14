// SPDX-License-Identifier: Apache-2.0
/**
 * 消息操作（F37）：桌面只剩右键菜单，窄档一颗「⋯」，两处菜单项同源。
 *
 * 旧断言按行内操作条的 `button` 取；现在改用 `fireEvent.contextMenu(bubble)` 打开菜单后
 * 按 `menuitem` 取——三件事必须仍然成立：重新生成只在最后一条助手回答、
 * 生成中禁用、每条消息都有复制。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但本文件只在 Node（vitest）里跑。
import { readFileSync } from "node:fs";
// @ts-expect-error 同上。
import { dirname, resolve } from "node:path";
// @ts-expect-error 同上。
import { fileURLToPath } from "node:url";
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssistantConversationDetail,
  AssistantMessage,
  AssistantToolCall,
} from "../../../types";
import { t } from "../../../i18n";

const createKnowledge = vi.fn();
vi.mock("../../../api/knowledge", () => ({
  createKnowledge: (...args: unknown[]) => createKnowledge(...args),
}));

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

const onDeleteMessage = vi.fn();

function renderList(
  props: { sending?: boolean; streamingTools?: AssistantToolCall[]; progressText?: string } = {},
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
        onDeleteMessage={onDeleteMessage}
        onRegenerate={vi.fn()}
        onEnterSelecting={vi.fn()}
        selecting={false}
        selectedIds={new Set<number>()}
        onToggleSelected={vi.fn()}
      />
    </AntdApp>,
  );
}

/** 打开第 index 条消息的右键菜单（span 内任意节点右键都行）。 */
async function openMenu(index: number) {
  const bubbles = document.querySelectorAll(".assistant-message");
  fireEvent.contextMenu(bubbles[index]);
  const menu = await screen.findByRole("menu");
  return within(menu);
}

function label(key: Parameters<typeof t>[0]) {
  return t(key);
}

/**
 * 按菜单项文案取元素：antd 把 `icon` 渲染成带 `aria-label` 的 `role="img"`，可访问名
 * 会是「copy 复制」，用 `{ name }` 精确匹配取不到。这里按可见文案（title-content）取，
 * 取不到就抛错——与 `getByRole` 一样是强断言，不会静默跳过。
 */
function menuItem(menu: ReturnType<typeof within>, key: Parameters<typeof t>[0]) {
  const text = label(key);
  const found = menu
    .getAllByRole("menuitem")
    .find((node: HTMLElement) => node.textContent === text);
  if (!found) throw new Error(`menu item not found: ${text}`);
  return found;
}

beforeEach(() => {
  createKnowledge.mockReset();
  createKnowledge.mockResolvedValue({ id: 21, title: "answer" });
  onDeleteMessage.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("message list actions (F37)", () => {
  it("puts every action in the context menu: regenerate only on the last assistant answer", async () => {
    renderList();
    const menu = await openMenu(3);
    const labels = menu.getAllByRole("menuitem").map((item) => item.textContent);
    expect(labels).toEqual([
      label("assistantUi.messageActions.quote"),
      label("assistantUi.messageActions.copy"),
      label("assistantUi.saveKnowledge.button"),
      label("assistantUi.messageActions.regenerate"),
      label("common.action.batchSelect"),
      label("assistantUi.messageActions.delete"),
    ]);
    // 每条消息都有复制（含用户消息）。
    cleanup();
    renderList();
    const first = await openMenu(0);
    expect(menuItem(first, "assistantUi.messageActions.copy")).toBeTruthy();
  });

  it("keeps regenerate disabled while generating", async () => {
    renderList({ sending: true });
    const menu = await openMenu(3);
    expect(menuItem(menu, "assistantUi.messageActions.regenerate")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("does not offer save/regenerate on user messages", async () => {
    renderList();
    const menu = await openMenu(2);
    const texts = menu.getAllByRole("menuitem").map((item) => item.textContent);
    expect(texts).not.toContain(label("assistantUi.saveKnowledge.button"));
    expect(texts).not.toContain(label("assistantUi.messageActions.regenerate"));
  });

  it("opens the save-as-knowledge dialog from the menu and shows the saved link", async () => {
    renderList();
    const menu = await openMenu(1);
    fireEvent.click(menuItem(menu, "assistantUi.saveKnowledge.button"));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t("assistantUi.saveKnowledge.save") }));
    await waitFor(() => expect(createKnowledge).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole("link", {
        name: t("assistantUi.saveKnowledge.saved", { title: "answer" }),
      }),
    ).toBeTruthy();
  });

  it("deletes through the menu after confirmation", async () => {
    renderList();
    const menu = await openMenu(2);
    fireEvent.click(menuItem(menu, "assistantUi.messageActions.delete"));
    const confirm = await screen.findByRole("button", {
      name: t("assistantUi.messageList.action.delete"),
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(onDeleteMessage).toHaveBeenCalledWith(DETAIL.messages[2]));
  });
});

describe("message actions css guard (F37)", () => {
  const css = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../styles/assistant-message-actions.css",
    ),
    "utf8",
  );

  it("removed the inline hover action bar", () => {
    // 只匹配独立的 `.assistant-message-actions` 规则块，不误伤 `-more` 后缀。
    expect(css).not.toMatch(/\.assistant-message-actions\s*\{/);
    expect(css).not.toContain("assistant-message-actions:hover");
  });

  it("shows the narrow ⋯ trigger only at ≤767px", () => {
    const queries = css.match(/@media\s*\(max-width:\s*767px\)/g) ?? [];
    expect(queries.length).toBeGreaterThan(0);
    expect(css).toMatch(
      /@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*\.assistant-message-actions-more/,
    );
    // 宽档默认隐藏。
    expect(css).toMatch(/\.assistant-message-actions-more\s*\{[\s\S]*?display:\s*none;[\s\S]*?\}/);
  });
});
