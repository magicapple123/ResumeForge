// SPDX-License-Identifier: Apache-2.0
/** 设置页「求职助手 · 数据权限」四档卡（T11）：读写全局默认、失败回滚、广播通知输入区。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getAssistantPermission: vi.fn(),
  saveAssistantPermission: vi.fn(),
}));

vi.mock("../../api/assistantPermission", () => apiMocks);

import AssistantRelaxedModeCard from "./AssistantRelaxedModeCard";
import {
  ASSISTANT_PERMISSION_LABEL_KEYS,
  resetAssistantPermissionForTests,
  subscribeAssistantPermission,
} from "../assistant/assistantPermission";
import { t } from "../../i18n";

function renderCard() {
  return render(
    <AntdApp>
      <AssistantRelaxedModeCard />
    </AntdApp>,
  );
}

async function radioFor(level: keyof typeof ASSISTANT_PERMISSION_LABEL_KEYS) {
  return screen.findByRole("radio", {
    name: new RegExp(t(ASSISTANT_PERMISSION_LABEL_KEYS[level])),
  });
}

beforeEach(() => {
  resetAssistantPermissionForTests();
  window.localStorage.clear();
  apiMocks.getAssistantPermission.mockReset();
  apiMocks.getAssistantPermission.mockResolvedValue({ permission: "read_only" });
  apiMocks.saveAssistantPermission.mockReset();
  apiMocks.saveAssistantPermission.mockImplementation(async (setting) => setting);
});

afterEach(() => {
  cleanup();
  resetAssistantPermissionForTests();
});

describe("AssistantRelaxedModeCard 四档全局默认", () => {
  it("四个档位都渲染，默认选中「仅查看」，并写清凭据/照片/删除边界", async () => {
    renderCard();

    expect(await radioFor("read_only")).toBeChecked();
    expect(await radioFor("read_full")).not.toBeChecked();
    expect(await radioFor("write_confirm")).not.toBeChecked();
    expect(await radioFor("write_full")).not.toBeChecked();

    // 提前告知：任何档位都不发送的东西
    expect(screen.getByText(t("assistantPermission.settings.neverSent"))).toBeInTheDocument();
    expect(screen.getByText(t("assistantPermission.settings.intro"))).toBeInTheDocument();
  });

  it("切到「放宽读取」：保存全局默认、更新状态行并通知输入区重取", async () => {
    const bumped = vi.fn();
    subscribeAssistantPermission(bumped);
    renderCard();

    fireEvent.click(await radioFor("read_full"));

    await waitFor(() =>
      expect(apiMocks.saveAssistantPermission).toHaveBeenCalledWith({ permission: "read_full" }),
    );
    expect(
      await screen.findByText(
        t("assistantPermission.settings.state", {
          level: t(ASSISTANT_PERMISSION_LABEL_KEYS.read_full),
        }),
      ),
    ).toBeInTheDocument();
    // 广播：输入区「跟随全局（…）」要立刻跟着变，而不是等下次刷新
    expect(bumped).toHaveBeenCalled();
  });

  it("写档位出现「会直接改数据」的提示，读档位不出现", async () => {
    renderCard();
    await radioFor("read_only");
    expect(screen.queryByText(t("assistantPermission.settings.writeHint"))).toBeNull();

    fireEvent.click(await radioFor("write_full"));
    expect(
      await screen.findByText(t("assistantPermission.settings.writeHint")),
    ).toBeInTheDocument();
  });

  it("保存失败时回滚选中项并提示，不广播", async () => {
    apiMocks.saveAssistantPermission.mockRejectedValue(new Error("保存失败"));
    const bumped = vi.fn();
    subscribeAssistantPermission(bumped);
    renderCard();

    fireEvent.click(await radioFor("write_confirm"));

    expect(await screen.findByText("保存失败")).toBeInTheDocument();
    await waitFor(async () => expect(await radioFor("read_only")).toBeChecked());
    expect(bumped).not.toHaveBeenCalled();
  });

  it("读取失败按「仅查看」保守显示", async () => {
    apiMocks.getAssistantPermission.mockRejectedValue(new Error("offline"));
    renderCard();

    await waitFor(async () => expect(await radioFor("read_only")).toBeChecked());
  });
});
