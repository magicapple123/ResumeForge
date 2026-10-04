/**
 * AssistantPage 测试的非 mock 测试基建（先例：src/test/resumeFixtures.ts）。
 *
 * 从 AssistantPage.test.tsx 拆分时提取：会话夹具、render 工具与空态观察器。
 * vi.mock 声明与 apiMocks **不**在这里——mock 必须留在每个测试文件内逐字声明
 * （vitest 按测试文件装配 mock 注册表），这里只放与 mock 无关的 harness。
 *
 * 本文件不是 `.test.` 文件：vitest 不收集、行数预算扫描不涉及。
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { expect, vi } from "vitest";
import type {
  AssistantConversationBrief,
  AssistantConversationDetail,
  AssistantSkill,
} from "../types";
import AssistantPage from "../pages/AssistantPage";

export const CREATED_AT = "2026-08-20T10:00:00";
export const CONVERSATIONS: AssistantConversationBrief[] = [
  {
    id: 1,
    title: "会话一",
    surface: "page",
    pinned: false,
    favorite: false,
    archived: false,
    group_name: "",
    message_count: 0,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  },
  {
    id: 2,
    title: "会话二",
    surface: "page",
    pinned: false,
    favorite: false,
    archived: false,
    group_name: "",
    message_count: 0,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  },
];

export function conversationDetail(id: number): AssistantConversationDetail {
  const conversation = CONVERSATIONS.find((item) => item.id === id);
  if (!conversation) throw new Error(`未知测试会话：${id}`);
  return { ...conversation, messages: [] };
}

export function makeSkill(id: number, name: string, enabled: boolean): AssistantSkill {
  return {
    id,
    name,
    description: "",
    enabled,
    source_name: `${name}.md`,
    prompt_chars: 120,
    files: [],
    updated_at: CREATED_AT,
  };
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/**
 * 打开左侧第一条会话。
 *
 * 进入助手页现在是**草稿态**（既不自动打开最近会话、也不建记录），所以"会话已经打开"
 * 这件事必须由用例自己点出来——不能为了让测试少写一行而把产品行为改回自动选中。
 *
 * apiMocks 由调用方传入：mock 对象本身必须留在各测试文件里（vi.hoisted），这里只消费它。
 */
export async function openFirstConversation(apiMocks: {
  getAssistantConversation: ReturnType<typeof vi.fn>;
}) {
  fireEvent.click(await screen.findByRole("button", { name: "会话一" }));
  await waitFor(() => expect(apiMocks.getAssistantConversation).toHaveBeenCalledWith(1));
}

export function renderPage(entry = "/assistant") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AntdApp>
        <AssistantPage />
      </AntdApp>
    </MemoryRouter>,
  );
}

/**
 * 记录空态元素的挂载与卸载。
 *
 * "闪一下"没法用某个时刻的断言捕捉——它在任何一次 findBy 之前就已经演出完了——所以只能在
 * 渲染前开始监听 DOM，事后数它被挂载了几次。
 */
export function watchEmptyState() {
  const events: string[] = [];
  const classify = (nodes: NodeList, kind: string) => {
    for (const node of Array.from(nodes)) {
      if (node instanceof HTMLElement && node.classList.contains("assistant-empty-state")) {
        events.push(kind);
      }
    }
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      classify(record.addedNodes, "add");
      classify(record.removedNodes, "remove");
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    return events;
  };
}

/** 带上路径探针，用来断言"点了之后去了哪"。 */
export function renderPageWithLocationProbe() {
  function LocationProbe() {
    return <span data-testid="current-path">{useLocation().pathname}</span>;
  }
  return render(
    <MemoryRouter>
      <AntdApp>
        <AssistantPage />
        <LocationProbe />
      </AntdApp>
    </MemoryRouter>,
  );
}
