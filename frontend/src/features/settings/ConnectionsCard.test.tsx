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
  copyConnectionSecret: vi.fn(),
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
    hint: "sk-a****bb44",
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
    key_map: [
      {
        id: "web_search.deepseek",
        label: "DeepSeek（联网搜索 / 抓取 / OCR 共用）",
        group: "web_search",
        group_label: "联网搜索与抓取",
        configure_at: "设置 → 联网搜索 → DeepSeek",
        used_by: "联网搜索、网页正文抓取、扫描件 OCR 共用这一把",
        empty_meaning: "留空并保存 = 移除这把 Key",
        where: "global_settings.json → web_search.deepseek_api_key",
      },
      {
        id: "llm.session",
        label: "仅本次会话使用的大模型 Key",
        group: "session",
        group_label: "仅本次会话",
        configure_at: "设置 → AI 模型 → 仅本次会话使用",
        used_by: "临时覆盖已保存的大模型 Key",
        empty_meaning: "清空 = 立刻回到已保存的那把 Key",
        where: "后端进程内存",
      },
    ],
    storage: { kind: "plaintext", label: "当前平台无系统加密", description: "密钥以明文落盘" },
    retrieved: true,
  };
}

/**
 * 按条目名定位**凭据行**：同一页有 7 行，而且 CR-12 的密钥地图里也有同名文本，
 * 所以取"最近祖先里有 .connection-row"的那一个。
 */
function rowOf(label: string): HTMLElement {
  const row = screen
    .getAllByText(label)
    .map((element) => element.closest(".connection-row"))
    .find((element) => element !== null);
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
  connMocks.copyConnectionSecret.mockResolvedValue({ ok: true });
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

  it("renders the key map with one row per credential", async () => {
    const emptyHint = payload().key_map?.[0]?.empty_meaning ?? "";
    renderCard();
    await waitFor(() => expect(connMocks.getConnections).toHaveBeenCalled());

    // CR-12：地图由后端投影，前端只渲染——行数必须等于后端给的条数（不在这里增删）。
    const map = (await screen.findByText(t("connections.keyMap.title"))).closest(
      ".connection-key-map",
    ) as HTMLElement;
    expect(within(map).getAllByRole("row")).toHaveLength(3); // 表头 + 2 条
    expect(within(map).getByText(t("connections.keyMap.col.empty"))).toBeInTheDocument();
    // 断言渲染的是后端给的「留空含义」，而不是前端另写一句（那句话会与 registry 漂移）。
    expect(within(map).getByText(emptyHint)).toBeInTheDocument();
  });

  it("writes a new search key through the search settings endpoint, keeping the other fields", async () => {
    renderCard();
    await waitFor(() => expect(connMocks.getConnections).toHaveBeenCalled());

    await screen.findAllByText(DEEPSEEK_LABEL);
    const row = within(rowOf(DEEPSEEK_LABEL));
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

  it("shows the first/last four hint and copies through the backend", async () => {
    renderCard();
    await waitFor(() => expect(connMocks.getConnections).toHaveBeenCalled());

    // hint 取代 `********` 作为展示值（掩码字段本身仍是协议值，不参与渲染）。
    await screen.findAllByText(DEEPSEEK_LABEL);
    const row = within(rowOf(DEEPSEEK_LABEL));
    expect(row.getByText("sk-a****bb44")).toBeInTheDocument();
    fireEvent.click(
      row.getByRole("button", { name: t("connections.action.more", { name: DEEPSEEK_LABEL }) }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: t("connections.action.copySecret") }),
    );

    // 明文只在后端手里：页面调接口让它写剪贴板，自己不碰密钥字符串。
    await waitFor(() =>
      expect(connMocks.copyConnectionSecret).toHaveBeenCalledWith("web_search.deepseek", ""),
    );
  });

  it("clears the session key with DELETE instead of writing an empty string", async () => {
    renderCard();
    await waitFor(() => expect(connMocks.getConnections).toHaveBeenCalled());

    const sessionLabel = t("connections.item.llm.session.label");
    await screen.findAllByText(sessionLabel);
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

  it("marks a borrowed model key on the search row (CR-06)", async () => {
    const base = payload();
    const searchGroup = base.groups.find((group) => group.id === "search");
    const borrowed = searchGroup?.items.find((entry) => entry.id === "web_search.deepseek");
    if (!borrowed) throw new Error("fixture is missing the search row");
    borrowed.key_configured = false;
    borrowed.status = "not_configured";
    borrowed.hint = "";
    borrowed.masked = "";
    borrowed.borrowed_key = true;
    connMocks.getConnections.mockResolvedValue(base);

    renderCard();
    await waitFor(() => expect(connMocks.getConnections).toHaveBeenCalled());

    await screen.findAllByText(DEEPSEEK_LABEL);
    const row = within(rowOf(DEEPSEEK_LABEL));
    fireEvent.click(
      row.getByRole("button", { name: t("connections.hint.aria", { name: DEEPSEEK_LABEL }) }),
    );
    expect(
      await screen.findByText(new RegExp(t("connections.hint.borrowedModelKey"))),
    ).toBeInTheDocument();
  });
});
