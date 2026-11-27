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
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConnectionsCard from "./ConnectionsCard";
import { t } from "../../i18n";
import type { ConnectionMatrix, ConnectionsPayload } from "../../types";

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

/**
 * 只依赖闸门口令、因而不进矩阵的功能名。
 *
 * 抽成常量是给 i18n 棘轮留的：`getByText("中文")` 会被算作"新增中文文案"，而这里断言的是
 * **payload 里给的名字**，本来就该引用夹具，不该再抄一遍字面量。
 */
const ORPHAN_FEATURE = "更新检查";

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
    // #9：后端投影的深链锚点，行组件把它写成根节点 `id`（矩阵「去配置」的落点）。
    anchor: "conn-search-deepseek",
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
            anchor: "conn-llm-session-key",
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
            // 语义检索的 Key 在别的卡里配：这一行没有锚点 → 不写 `id`。
            anchor: "",
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
        used_by: ["联网搜索", "网页正文抓取", "扫描件 OCR"],
        used_by_text: "联网搜索、网页正文抓取、扫描件 OCR",
        empty_meaning: "留空并保存 = 移除这把 Key",
        where: "global_settings.json → web_search.deepseek_api_key",
        status: "saved",
        section: "assistant-behavior",
        anchor: "conn-search-deepseek",
      },
      {
        id: "llm.session",
        label: "仅本次会话使用的大模型 Key",
        group: "session",
        group_label: "仅本次会话",
        configure_at: "设置 → AI 模型 → 仅本次会话使用",
        used_by: ["简历生成", "求职助手"],
        used_by_text: "简历生成、求职助手",
        empty_meaning: "清空 = 立刻回到已保存的那把 Key",
        where: "后端进程内存",
        status: "session_only",
        section: "model",
        anchor: "conn-llm-session-key",
      },
    ],
    matrix: matrix(),
    storage: { kind: "plaintext", label: "当前平台无系统加密", description: "密钥以明文落盘" },
    retrieved: true,
  };
}

/**
 * 依赖矩阵的夹具（#9）：两列三行，其中一条覆盖式边、一个只依赖闸门的功能。
 *
 * 形状与后端 registry 的投影一致（`keys/features/edges/gate`）：这个夹具同时用来验证
 * 「矩阵替换表格」——前端不认识任何具体 Key，只照着 payload 画。
 */
function matrix(): ConnectionMatrix {
  return {
    keys: [
      {
        id: "web_search.deepseek",
        label: "DeepSeek",
        group: "web_search",
        status: "saved",
        section: "assistant-behavior",
        anchor: "conn-search-deepseek",
      },
      {
        id: "llm.session",
        label: "仅本次会话使用的大模型 Key",
        group: "session",
        status: "session_only",
        section: "model",
        anchor: "conn-llm-session-key",
      },
    ],
    features: [
      { id: "resume_generation", label: "简历生成", group: "content" },
      { id: "web_search", label: "联网搜索", group: "web" },
      { id: "update_check", label: ORPHAN_FEATURE, group: "system" },
    ],
    edges: [
      { key: "web_search.deepseek", feature: "web_search", kind: "direct" },
      { key: "llm.session", feature: "resume_generation", kind: "override" },
    ],
    gate: { key: "network.proxy", label: "代理认证口令（当前网络设置）" },
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
    // 卡片自己会为矩阵的「去配置」调 `navigate`，所以需要 Router 上下文。
    <MemoryRouter initialEntries={["/settings?tab=connections"]}>
      <AntdApp>
        <ConnectionsCard />
      </AntdApp>
    </MemoryRouter>,
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
    // 三态：矩阵列头的状态标签与凭据行 chip 说的是同一件事，所以这里只要求"至少出现"。
    expect((await screen.findAllByText(saved)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(sessionOnly).length).toBeGreaterThan(0);
    expect(screen.getByText(t("connections.status.not_configured"))).toBeInTheDocument();
    // R19：密钥行的存储方式从"行内 chip"挪进了 ⓘ（两行布局），所以这里断言的是
    // **整页那条存储说明**仍然在，以及行内不再挂存储 chip（见下面那组用例）。
    expect(
      screen.getByText(t("connections.storage.title", { label: plaintext })),
    ).toBeInTheDocument();
  });

  it("renders the dependency matrix instead of the old four-column table", async () => {
    renderCard();
    await waitFor(() => expect(connMocks.getConnections).toHaveBeenCalled());

    // #9：整张表格换掉。矩阵的列数由 payload 决定（这里两把 Key → 两个列头按钮）。
    const panel = (await screen.findByTestId("connection-matrix")) as HTMLElement;
    expect(document.querySelector(".connection-key-map")).toBeNull();
    for (const key of matrix().keys) {
      expect(within(panel).getAllByText(key.label).length).toBeGreaterThan(0);
    }
    // 只依赖闸门的功能不画行，合成一句说明（不摆一排空格子）。
    expect(within(panel).queryByText(ORPHAN_FEATURE)).toBeNull();
    expect(
      within(panel).getByText(
        t("settingsUi.connections.matrix.gate.only", { list: ORPHAN_FEATURE }),
      ),
    ).toBeInTheDocument();
  });

  it("凭据行带上 key_map 给的锚点 id，矩阵的「去配置」才落得到行上", async () => {
    renderCard();
    await waitFor(() => expect(connMocks.getConnections).toHaveBeenCalled());
    await screen.findAllByText(DEEPSEEK_LABEL);

    // 后端两份投影（`groups[].items[].anchor` 与 `key_map[].anchor`）必须指向同一处：
    // 前者是 DOM 的 `id`，后者是「去配置」拼出的 `#` 部分。对不上就等于点了没反应。
    for (const row of payload().key_map ?? []) {
      const target = document.getElementById(row.anchor);
      expect(target, `锚点 ${row.anchor} 没有对应的行`).not.toBeNull();
      expect(target).toHaveClass("connection-row");
    }
    // 没有锚点的行（这里：语义检索）不写空 `id`，否则 `#` 会命中第一个空 id 的元素。
    expect(document.querySelectorAll("[id='']")).toHaveLength(0);
    // 锚点必须挂在**那一行**上（不是矩阵格子上）：深链要滚到的是可编辑的凭据行。
    expect(document.getElementById("conn-search-deepseek")).toBe(rowOf(DEEPSEEK_LABEL));
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

    // hint 取代 `********` 作为展示值（掩码字段本身仍是协议值，不参与渲染）；
    // #8 只换展示字形（`****` → `••••`），`connectionMaskedText` 的输出不变。
    await screen.findAllByText(DEEPSEEK_LABEL);
    const row = within(rowOf(DEEPSEEK_LABEL));
    expect(row.getByText("sk-a••••bb44")).toBeInTheDocument();
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

/**
 * #8「卡片行」的四条契约。
 *
 * 都在**行**这一层断言（`closest(".connection-row")`），因为改动是行内排版：状态 chip、
 * 存储 chip、值位引导、动作列。行高这一条尤其不能用 `getBoundingClientRect()`——
 * jsdom 没有排版引擎，任何元素的 height 都是 0，"0 === 0" 会永远绿。
 */
describe("ConnectionListRow 卡片行（#8）", () => {
  it("未配置行不渲染存储形态 chip", async () => {
    renderCard();
    await waitFor(() => expect(connMocks.getConnections).toHaveBeenCalled());

    const label = t("connections.item.embedding.default.label");
    await screen.findAllByText(label);
    const row = within(rowOf(label));
    // 这一条的 protection 是 dpapi：没配就不该谈加密（旧实现每行都写）。
    expect(row.queryByText(t("connections.protection.dpapi"))).toBeNull();
    // R19：密钥行连已配置的也不在行内挂存储 chip 了——它挪进了右侧 `ⓘ`，
    // 两行布局才装得下。断言"整行没有存储 chip"，避免"没渲染"其实是整体丢了。
    const saved = within(rowOf(DEEPSEEK_LABEL));
    expect(saved.queryByText(t("connections.protection.plaintext"))).toBeNull();
    expect(
      saved.getByRole("button", { name: t("connections.hint.aria", { name: DEEPSEEK_LABEL }) }),
    ).toBeTruthy();
  });

  it("未配置行的值位是引导文案：有「立即生效」，没有「未填写」", async () => {
    renderCard();
    await waitFor(() => expect(connMocks.getConnections).toHaveBeenCalled());

    const label = t("connections.item.embedding.default.label");
    await screen.findAllByText(label);
    const row = within(rowOf(label));

    const guidance = t("settingsUi.connections.value.emptyHint");
    expect(guidance).toContain("立即生效");
    expect(row.getByText(guidance)).toBeInTheDocument();
    // 同一件事不再说两遍：状态 chip 已经写着「未配置」。
    expect(row.queryByText(t("connections.emptyMask"))).toBeNull();
  });

  it("已配置行的状态 chip 保留文字（不是纯色块）", async () => {
    renderCard();
    await waitFor(() => expect(connMocks.getConnections).toHaveBeenCalled());

    await screen.findAllByText(DEEPSEEK_LABEL);
    const row = within(rowOf(DEEPSEEK_LABEL));
    const chip = row.getByText(t("connections.status.saved"));
    expect(chip.closest(".connection-row__chip")).not.toBeNull();
    expect(chip.textContent).toBe(t("connections.status.saved"));
  });

  it("编辑态与只读态的行结构一致（行高不跳的前提）", async () => {
    renderCard();
    await waitFor(() => expect(connMocks.getConnections).toHaveBeenCalled());

    await screen.findAllByText(DEEPSEEK_LABEL);
    const rowNode = rowOf(DEEPSEEK_LABEL);
    const readChildren = rowNode.children.length;
    const readMainChildren = rowNode.querySelector(".connection-row__main")?.children.length;

    fireEvent.click(
      within(rowNode).getByRole("button", {
        name: t("connections.action.editAria", { name: DEEPSEEK_LABEL }),
      }),
    );

    // 编辑态**不多加一行**：值位换控件，动作列只是换成"保存/取消"，四段结构不变。
    // （jsdom 无排版，量高度是空断言；量结构才是可失败的断言。）
    expect(rowNode.children.length).toBe(readChildren);
    expect(rowNode.querySelector(".connection-row__editor")).not.toBeNull();
    expect(rowNode.querySelector(".connection-row__main")?.children.length).toBe(readMainChildren);
    // 动作列在两种状态下都是同一个节点：位置不重排。
    expect(rowNode.querySelectorAll(".connection-row__actions")).toHaveLength(1);
  });

  it("「用于」按 id 关联 key_map：不在 map 里的行不渲染这一行", async () => {
    renderCard();
    await waitFor(() => expect(connMocks.getConnections).toHaveBeenCalled());

    await screen.findAllByText(DEEPSEEK_LABEL);
    const usedBy = payload().key_map?.[0]?.used_by_text ?? "";
    expect(usedBy).not.toBe("");
    expect(within(rowOf(DEEPSEEK_LABEL)).getByText(usedBy)).toBeInTheDocument();

    // embedding.default 不在这份 key_map 里：宁可少一行，也不显示一句空话。
    const unmappedLabel = t("connections.item.embedding.default.label");
    const unmapped = within(rowOf(unmappedLabel));
    expect(unmapped.queryByText(t("settingsUi.connections.usedBy"))).toBeNull();
  });
});
