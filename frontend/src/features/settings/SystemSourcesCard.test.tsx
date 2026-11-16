// SPDX-License-Identifier: Apache-2.0
/**
 * 「外部连接」C 组（T12）的定向用例。
 *
 * 断言"可编辑"是真的可编辑：改值走 `PUT /connections/system/<id>`，恢复默认走
 * `DELETE`（后端删掉覆盖值，而不是写一个"默认值"进去），并且**不改的那一项不会
 * 被顺手写一遍**。
 */

import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ConnectionsPayload } from "../../types";
import SystemSourcesCard from "./SystemSourcesCard";

const connMocks = vi.hoisted(() => ({
  getConnections: vi.fn(),
  saveSystemSource: vi.fn(),
  resetSystemSource: vi.fn(),
  setLLMSessionKey: vi.fn(),
  clearLLMSessionKey: vi.fn(),
}));

vi.mock("../../api/connections", () => connMocks);

const PORT_LABEL = t("connections.item.system.browser_port.label");

function systemItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "system.browser_port",
    label: "浏览器调试端口",
    kind: "system" as const,
    status: "modified" as const,
    status_label: "已改过",
    detail: "改过之后可随时恢复默认",
    masked: "",
    key_configured: false,
    protection: "config_file" as const,
    protection_label: "明文配置文件",
    protection_description: "保存在本机的 global_settings.json 里",
    editable: true,
    write_hint: "投递专用浏览器的调试端口",
    target_id: "system.browser_port",
    location: "",
    value: "9400",
    default_value: "9333",
    is_default: false,
    ...overrides,
  };
}

function payload(port = systemItem()): ConnectionsPayload {
  return {
    groups: [
      { id: "ai", label: "AI 服务", kind: "credential", hint: "", items: [] },
      { id: "search", label: "搜索来源", kind: "credential", hint: "", items: [] },
      {
        id: "system",
        label: "系统来源与端口",
        kind: "system",
        hint: "下载源与浏览器端口",
        items: [
          port,
          systemItem({
            id: "system.font_base_url",
            label: "字体下载源",
            status: "default",
            status_label: "默认值",
            value: "https://mirrors.example.com/f/",
            default_value: "https://mirrors.example.com/f/",
            is_default: true,
          }),
        ],
      },
    ],
    storage: { kind: "dpapi", label: "DPAPI 加密", description: "" },
    retrieved: true,
  };
}

function renderCard() {
  return render(
    <AntdApp>
      <SystemSourcesCard />
    </AntdApp>,
  );
}

beforeEach(() => {
  connMocks.getConnections.mockResolvedValue(payload());
  connMocks.saveSystemSource.mockResolvedValue(
    payload(systemItem({ value: "9401", is_default: false })),
  );
  connMocks.resetSystemSource.mockResolvedValue(
    payload(systemItem({ value: "9333", is_default: true, status: "default" })),
  );
});

afterEach(() => {
  cleanup();
  // `⋯` 菜单的浮层挂在 body 上：清掉，免得上一条用例的菜单项让下一条的
  // `getByRole("menuitem")` 命中两个。
  document.querySelectorAll(".ant-dropdown, .ant-modal-root").forEach((node) => node.remove());
  vi.clearAllMocks();
});

describe("SystemSourcesCard", () => {
  it("shows the effective value next to the factory default", async () => {
    renderCard();
    expect(await screen.findByText("9400")).toBeInTheDocument();
    // 已偏离出厂值才补这句（出厂值行不重复渲染一份与当前值相同的文本）。
    expect(
      screen.getByText(t("connections.system.factoryValue", { value: "9333" })),
    ).toBeInTheDocument();
    // 这四项不是密钥：存储标注是"明文配置文件"，不是 DPAPI 那一套。
    expect(screen.getAllByText(t("connections.protection.config_file")).length).toBe(2);
  });

  it("saves an edited value through the C-group endpoint", async () => {
    renderCard();
    const row = within(
      (await screen.findByText(PORT_LABEL)).closest(".connection-row") as HTMLElement,
    );
    fireEvent.click(
      row.getByRole("button", { name: t("connections.action.editValue", { name: PORT_LABEL }) }),
    );

    fireEvent.change(row.getByLabelText(PORT_LABEL), { target: { value: "9401" } });
    fireEvent.click(
      row.getByRole("button", { name: t("connections.action.saveValue", { name: PORT_LABEL }) }),
    );

    await waitFor(() =>
      expect(connMocks.saveSystemSource).toHaveBeenCalledWith("system.browser_port", "9401"),
    );
    expect(await screen.findByText("9401")).toBeInTheDocument();
  });

  it("restores the default with DELETE and leaves untouchable rows alone", async () => {
    renderCard();
    const row = within(
      (await screen.findByText(PORT_LABEL)).closest(".connection-row") as HTMLElement,
    );
    // 「恢复默认」从行内收进了 `⋯`：行里常驻操作只剩主按钮（修改）+ `⋯`。
    fireEvent.click(
      row.getByRole("button", { name: t("connections.action.more", { name: PORT_LABEL }) }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: t("connections.action.reset") }));

    await waitFor(() =>
      expect(connMocks.resetSystemSource).toHaveBeenCalledWith("system.browser_port"),
    );
    expect(connMocks.saveSystemSource).not.toHaveBeenCalled();

    // 恢复默认之后这一项已无"恢复默认"可点：菜单里**不存在**该动作（不是渲染成 disabled）。
    const restored = within(screen.getByText(PORT_LABEL).closest(".connection-row") as HTMLElement);
    fireEvent.click(
      restored.getByRole("button", { name: t("connections.action.more", { name: PORT_LABEL }) }),
    );
    expect(
      await screen.findByRole("menuitem", { name: t("connections.action.copy") }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("connections.action.reset") })).toBeNull();
  });
});
