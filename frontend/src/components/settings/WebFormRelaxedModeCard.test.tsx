// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「网申填表 · 放宽模式」卡。
 *
 * #37：默认态就要把**四类始终不代填**的边界说全（日期 / 文件上传 / 密码·验证码·银行卡 /
 * 无弹层只读点选框），不能只列两类。文案本体在语言包里，这里守组件确实渲染了它。
 */
import { App as AntdApp } from "antd";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import settingsUiZh from "../../i18n/messages/zh-CN.settingsUi";
import WebFormRelaxedModeCard from "./WebFormRelaxedModeCard";

const apiMocks = vi.hoisted(() => ({
  getWebFormRelaxedMode: vi.fn(),
  saveWebFormRelaxedMode: vi.fn(),
}));

vi.mock("../../api/settings", () => apiMocks);

afterEach(() => cleanup());

beforeEach(() => {
  apiMocks.getWebFormRelaxedMode.mockResolvedValue({ enabled: false });
  apiMocks.saveWebFormRelaxedMode.mockImplementation(
    async (setting: { enabled: boolean }) => setting,
  );
});

function renderCard() {
  return render(
    <AntdApp>
      <WebFormRelaxedModeCard />
    </AntdApp>,
  );
}

describe("WebFormRelaxedModeCard", () => {
  it("默认关闭态：说明里点明四类始终不代填的控件", async () => {
    renderCard();
    await waitFor(() => expect(apiMocks.getWebFormRelaxedMode).toHaveBeenCalledTimes(1));

    const warning = settingsUiZh["settingsUi.webFormRelaxed.warning"];
    expect(screen.getByText(warning)).toBeInTheDocument();
    // 四类是并列短语（日期 / 文件 / 凭据 / 无弹层点选），按顿号计数防止只写两类。
    expect(warning.split("、").length).toBeGreaterThanOrEqual(4);
  });
});
