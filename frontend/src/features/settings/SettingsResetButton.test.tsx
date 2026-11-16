// SPDX-License-Identifier: Apache-2.0
/**
 * 「恢复默认」按钮（I-10）的三条底线。
 *
 * 这三条守的是**用户可感知的失败模式**，不是实现细节：
 * 1. 后端说"没有可重置项"时，页面上不该出现一颗点了没反应的按钮（灰按钮比没有更糟：
 *    用户会以为功能坏了）；
 * 2. 点击后必须二次确认，且请求体必须真的带上 `scope`——按钮显示"恢复"、实际发了一个空
 *    请求，是最难被发现的一类回归；
 * 3. 失败必须说出口。静默失败等于用户以为已经回到出厂值，实际没有。
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import zh from "../../i18n/messages/zh-CN.settingsReset";
import SettingsResetButton, { SETTINGS_RESET_EVENT } from "./SettingsResetButton";
import type { ResetTarget } from "./useSettingsReset";

const apiMocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("../../api/client", () => apiMocks);

/** 一项「已改过」的可重置设置（model 作用域）。 */
const MODEL_TARGET: ResetTarget = {
  key: "llm_config",
  scope: "model",
  kind: "fields",
  storage: "json",
  default: { temperature: 0.1 },
  current: { temperature: 0.9 },
  is_default: false,
};

const RESET_OK = {
  reset: [
    {
      key: "llm_config",
      scope: "model",
      before: { temperature: 0.9 },
      after: { temperature: 0.1 },
    },
  ],
  skipped: [],
  dataset_scoped: true,
};

/** 让 GET `/settings/reset-targets` 返回给定项；其它路径由用例自己补。 */
function mockTargets(entries: ResetTarget[]) {
  apiMocks.request.mockImplementation(async (path: string) => {
    if (path === "/settings/reset-targets") return { scopes: ["model"], entries };
    throw new Error(`unexpected path: ${path}`);
  });
}

/**
 * antd 会给**两个汉字**的按钮文案中间插一个空格（`恢 复`），按字面量查不到。
 * 这里在字符之间允许任意空白：文案仍然来自语言包，不是把中文抄一份进来。
 */
const CONFIRM_OK_NAME = new RegExp(`^${zh["settingsReset.confirm.ok"].split("").join("\\s*")}$`);

function confirmOkButton() {
  return screen.findByRole("button", { name: CONFIRM_OK_NAME });
}

function renderButton() {
  return render(
    <AntdApp>
      <SettingsResetButton scope="model" />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.request.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SettingsResetButton", () => {
  it("没有可重置项时不渲染按钮", async () => {
    mockTargets([]);
    renderButton();

    await waitFor(() => expect(apiMocks.request).toHaveBeenCalledWith("/settings/reset-targets"));
    // 取数完成（loading 结束）后仍然不该出现入口。
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: zh["settingsReset.action"] })).toBeNull(),
    );
  });

  it("有可重置项时渲染，确认后按 scope 提交并广播事件", async () => {
    mockTargets([MODEL_TARGET]);
    apiMocks.request.mockImplementation(async (path: string) => {
      if (path === "/settings/reset-targets") {
        return { scopes: ["model"], entries: [MODEL_TARGET] };
      }
      if (path === "/settings/reset") return RESET_OK;
      throw new Error(`unexpected path: ${path}`);
    });
    const onResetEvent = vi.fn();
    window.addEventListener(SETTINGS_RESET_EVENT, onResetEvent);
    try {
      renderButton();

      const trigger = await screen.findByRole("button", { name: zh["settingsReset.action"] });
      fireEvent.click(trigger);

      // 二次确认：确认按钮用的是「恢复」而不是「确定」，与文案同一口径。
      fireEvent.click(await confirmOkButton());

      await waitFor(() =>
        expect(apiMocks.request).toHaveBeenCalledWith("/settings/reset", {
          method: "POST",
          body: JSON.stringify({ scope: "model" }),
        }),
      );
      expect(await screen.findByText(t("settingsReset.done", { count: 1 }))).toBeTruthy();
      expect(onResetEvent).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(SETTINGS_RESET_EVENT, onResetEvent);
    }
  });

  it("恢复失败时提示失败文案，且不广播成功事件", async () => {
    apiMocks.request.mockImplementation(async (path: string) => {
      if (path === "/settings/reset-targets") {
        return { scopes: ["model"], entries: [MODEL_TARGET] };
      }
      throw new Error("重置接口 500");
    });
    const onResetEvent = vi.fn();
    window.addEventListener(SETTINGS_RESET_EVENT, onResetEvent);
    try {
      renderButton();

      fireEvent.click(await screen.findByRole("button", { name: zh["settingsReset.action"] }));
      fireEvent.click(await confirmOkButton());

      expect(await screen.findByText(zh["settingsReset.failed"])).toBeTruthy();
      // 失败还广播事件，卡片会去重取一遍"没变的值"，用户看到的却是"什么都没发生"。
      expect(onResetEvent).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(SETTINGS_RESET_EVENT, onResetEvent);
    }
  });
});
