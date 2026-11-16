// SPDX-License-Identifier: Apache-2.0
/**
 * 「外部连接」页 A/B 组（T11）的定向用例。
 *
 * 断言的重点是**契约**而不是外观：
 * 1. 三态与存储方式各自独立显示（"已保存"与"明文/DPAPI"不是同一个维度）；
 * 2. 就地改 Key 走的是该来源自己的域端点（联网搜索那份整配置回写，只换一个字段）；
 * 3. 清除是**真清除**：会话密钥走 DELETE，不是往 PUT 里塞空串。
 */

import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConnectionsCard from "./ConnectionsCard";
import { t } from "../../i18n";
import type { ConnectionsPayload } from "../../types";

const connMocks = vi.hoisted(() => ({
  getConnections: vi.fn(),
  saveSystemSource: vi.fn(),
  resetSystemSource: vi.fn(),
  setLLMSessionKey: vi.fn(),
  clearLLMSessionKey: vi.fn(),
}));
const settingsMocks = vi.hoisted(() => ({
  getSearchConfig: vi.fn(),
  saveSearchConfig: vi.fn(),
  getLLMConfig: vi.fn(),
  saveLLMConfig: vi.fn(),
}));

vi.mock("../../api/connections", () => connMocks);
vi.mock("../../api/settings", () => settingsMocks);

const SEARCH_CONFIG = {
  sources: ["bing", "deepseek"],
  searxng_url: "",
  depth: "standard",
  max_results: 8,
  deepseek_api_key: "********",
  tavily_api_key: "",
  jina_api_key: "",
};

function item(overrides: Partial<ConnectionsPayload["groups"][number]["items"][number]>) {
  return {
    id: "web_search.deepseek",
    label: "DeepSeek (search / fetch / OCR)",
    kind: "credential" as const,
    status: "saved" as const,
    status_label: "已保存",
    detail: "",
    masked: "********",
    key_configured: true,
    protection: "plaintext" as const,
    protection_label: "当前平台无系统加密",
    protection_description: "当前系统没有可用的加密后端",
    editable: true,
    write_hint: "清空即移除",
    target_id: "",
    location: "",
    value: "",
    default_value: "",
    is_default: false,
    ...overrides,
  };
}

function payload(): ConnectionsPayload {
  return {
    groups: [
      {
        id: "ai",
        label: "AI 服务",
        kind: "credential",
        hint: "模型与语音用的密钥",
        items: [
          item({
            id: "llm.session",
            label: "仅本次会话使用的大模型 Key",
            status: "session_only",
            status_label: "仅本次会话",
            protection: "memory_only",
            protection_label: "仅内存，不落盘",
            masked: "********",
          }),
          item({
            id: "embedding.default",
            label: "语义检索 API Key（当前生效配置）",
            status: "not_configured",
            status_label: "未配置",
            masked: "",
            key_configured: false,
            editable: false,
            write_hint: "语义检索的 Key 在「AI 模型 → 语义检索」里配置",
            protection_label: "DPAPI 加密",
            protection: "dpapi",
          }),
        ],
      },
      {
        id: "search",
        label: "搜索来源",
        kind: "credential",
        hint: "搜索与抓取用的密钥",
        items: [item({})],
      },
      { id: "system", label: "系统来源与端口", kind: "system", hint: "", items: [] },
    ],
    storage: { kind: "plaintext", label: "当前平台无系统加密", description: "密钥以明文落盘" },
    retrieved: true,
  };
}

/** 按条目名定位那一行：同一页有 7 行，"第几个按钮"这种定位会随顺序变。 */
function rowOf(label: string): HTMLElement {
  const row = screen.getByText(label).closest(".connection-row");
  if (!row) throw new Error(`找不到 ${label} 所在的行`);
  return row as HTMLElement;
}

const DEEPSEEK_LABEL = t("connections.item.web_search.deepseek.label");

function renderCard() {
  return render(
    <AntdApp>
      <ConnectionsCard />
    </AntdApp>,
  );
}

beforeEach(() => {
  connMocks.getConnections.mockResolvedValue(payload());
  settingsMocks.getSearchConfig.mockResolvedValue(SEARCH_CONFIG);
  settingsMocks.saveSearchConfig.mockImplementation(async (config) => config);
  connMocks.setLLMSessionKey.mockResolvedValue({ configured: true });
  connMocks.clearLLMSessionKey.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  // `modal.confirm`（`⋯` 菜单里的二次确认）与 Dropdown 的浮层挂在 body 上，
  // cleanup 之后可能还剩一层壳；清掉，免得下一条用例拿到上一条的残留菜单项。
  document
    .querySelectorAll(".ant-modal-root, .ant-dropdown, .ant-popover")
    .forEach((node) => node.remove());
  vi.clearAllMocks();
});

describe("ConnectionsCard", () => {
  it("shows the three states next to the storage label, not merged into one word", async () => {
    renderCard();
    const saved = t("connections.status.saved");
    const sessionOnly = t("connections.status.session_only");
    const plaintext = t("connections.protection.plaintext");
    expect(await screen.findByText(saved)).toBeInTheDocument();
    expect(screen.getAllByText(sessionOnly).length).toBeGreaterThan(0);
    expect(screen.getByText(t("connections.status.not_configured"))).toBeInTheDocument();
    // 存储方式与状态是两个标签：语义检索那条是 DPAPI，搜索那条是明文。
    expect(screen.getByText(t("connections.protection.dpapi"))).toBeInTheDocument();
    expect(screen.getAllByText(plaintext).length).toBeGreaterThan(0);
    expect(
      screen.getByText(t("connections.storage.title", { label: plaintext })),
    ).toBeInTheDocument();
  });

  it("writes a new search key through the search settings endpoint, keeping the other fields", async () => {
    renderCard();
    await waitFor(() => expect(connMocks.getConnections).toHaveBeenCalled());

    const row = within(
      (await screen.findByText(DEEPSEEK_LABEL)).closest(".connection-row") as HTMLElement,
    );
    fireEvent.click(
      row.getByRole("button", { name: t("connections.action.editAria", { name: DEEPSEEK_LABEL }) }),
    );

    fireEvent.change(row.getByLabelText(t("connections.input.label", { name: DEEPSEEK_LABEL })), {
      target: { value: "sk-new-search-key" },
    });
    fireEvent.click(
      row.getByRole("button", { name: t("connections.action.saveAria", { name: DEEPSEEK_LABEL }) }),
    );

    await waitFor(() =>
      expect(settingsMocks.saveSearchConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          sources: ["bing", "deepseek"],
          max_results: 8,
          deepseek_api_key: "sk-new-search-key",
        }),
      ),
    );
    // 改完刷新状态：后端算三态，前端不自己猜。
    await waitFor(() => expect(connMocks.getConnections).toHaveBeenCalledTimes(2));
  });

  it("clears the session key with DELETE instead of writing an empty string", async () => {
    renderCard();
    await waitFor(() => expect(connMocks.getConnections).toHaveBeenCalled());

    const sessionLabel = t("connections.item.llm.session.label");
    await screen.findByText(sessionLabel);
    const row = within(rowOf(sessionLabel));
    // 「清除」不可逆，所以它不在行内平铺（每行常驻操作只剩主按钮 + `⋯`），
    // 但收进菜单之后二次确认一步不少。
    fireEvent.click(
      row.getByRole("button", { name: t("connections.action.more", { name: sessionLabel }) }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: t("connections.action.clear") }));
    // 确认按钮的文案是"清除这把 Key"（写清后果），与菜单项「清除」不是同一个名字。
    fireEvent.click(await screen.findByRole("button", { name: t("connections.clear.title") }));

    await waitFor(() => expect(connMocks.clearLLMSessionKey).toHaveBeenCalledOnce());
    expect(settingsMocks.saveSearchConfig).not.toHaveBeenCalled();
  });
});
