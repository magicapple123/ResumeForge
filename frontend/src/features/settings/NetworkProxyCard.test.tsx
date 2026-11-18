// SPDX-License-Identifier: Apache-2.0
/**
 * 出网与代理卡（T02 / T05）：
 * 1. 默认「跟随系统」且「信任系统证书库」关闭——两者都是"不要自作主张"的默认值；
 * 2. 选「直连」必须当场看到警示（这是唯一会让用户自己把自己断网的开关）；
 * 3. 保存时把开关一起带上去；
 * 4. 检测到代理时给可关闭提示，关掉后按机器记住。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getNetworkSettings: vi.fn(),
  saveNetworkSettings: vi.fn(),
  getLLMConfig: vi.fn(),
  testLLM: vi.fn(),
}));

vi.mock("../../api/settingsNetwork", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/settingsNetwork")>()),
  getNetworkSettings: apiMocks.getNetworkSettings,
  saveNetworkSettings: apiMocks.saveNetworkSettings,
}));
vi.mock("../../api/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/settings")>()),
  getLLMConfig: apiMocks.getLLMConfig,
  testLLM: apiMocks.testLLM,
}));

import NetworkProxyCard from "./NetworkProxyCard";
import { t } from "../../i18n";

const BASE = {
  proxy_mode: "system" as const,
  proxy_url: "",
  proxy_username: "",
  has_password: false,
  trust_system_certs: false,
  effective: {
    source: "direct",
    source_label: "直连",
    var: "",
    scheme: "",
    host_port: "",
    has_auth: false,
    is_direct: true,
  },
  detected: {
    source: "registry",
    source_label: "注册表",
    var: "",
    scheme: "http",
    host_port: "127.0.0.1:7890",
    has_auth: false,
    is_direct: false,
  },
  supports_socks: false,
  notice: "",
};

function renderCard() {
  render(
    <AntdApp>
      <NetworkProxyCard />
    </AntdApp>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});
beforeEach(() => {
  apiMocks.getNetworkSettings.mockReset();
  apiMocks.saveNetworkSettings.mockReset();
  apiMocks.getLLMConfig.mockReset();
  apiMocks.testLLM.mockReset();
  apiMocks.getNetworkSettings.mockResolvedValue(BASE);
  // 保存接口回的是**刚存下的配置**：照抄 BASE 会让"自定义模式 + 已存密码"保存后
  // 突然变回「跟随系统」，自定义区随之卸载——那不是产品行为，是 mock 不真。
  apiMocks.saveNetworkSettings.mockImplementation(async (payload) => ({
    ...BASE,
    ...payload,
    has_password: Boolean(payload.proxy_password) || BASE.has_password,
  }));
});

describe("NetworkProxyCard", () => {
  it("默认跟随系统、证书开关关闭，并给出检测到的代理", async () => {
    renderCard();
    await waitFor(() => expect(apiMocks.getNetworkSettings).toHaveBeenCalled());

    expect(screen.getByLabelText(t("settingsUi.network.trust"))).not.toBeChecked();
    // 检测提示写清 host:port 与来源，用户才能判断"这是不是我的代理"。
    expect(screen.getByText(/127\.0\.0\.1:7890/)).toBeTruthy();
  });

  it("选直连时当场给出断网警示", async () => {
    renderCard();
    await waitFor(() => expect(apiMocks.getNetworkSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByText(t("settingsUi.network.mode.direct")));
    expect(screen.getByText(t("settingsUi.network.directWarning"))).toBeTruthy();
  });

  it("保存时把证书开关一起带上", async () => {
    renderCard();
    await waitFor(() => expect(apiMocks.getNetworkSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText(t("settingsUi.network.trust")));
    // antd 会在两个汉字之间插一个空格（「保 存」），按角色 + 正则找。
    fireEvent.click(screen.getByRole("button", { name: /保\s*存|^Save$/ }));
    await waitFor(() =>
      expect(apiMocks.saveNetworkSettings).toHaveBeenCalledWith(
        expect.objectContaining({ trust_system_certs: true }),
      ),
    );
  });

  it("双线路测试给出两行结论", async () => {
    apiMocks.getLLMConfig.mockResolvedValue({ base_url: "https://api.deepseek.com", model: "x" });
    apiMocks.testLLM
      .mockResolvedValueOnce({ ok: false, latency_ms: null, message: "proxy refused" })
      .mockResolvedValueOnce({ ok: true, latency_ms: 120, message: "" });
    renderCard();
    await waitFor(() => expect(apiMocks.getNetworkSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText(t("settingsUi.network.probe")));
    await waitFor(() => expect(screen.getByTestId("network-probe-lines")).toBeTruthy());
    expect(apiMocks.testLLM).toHaveBeenNthCalledWith(2, expect.anything(), "task", true);
    expect(screen.getByText(new RegExp(t("settingsUi.network.probeOk")))).toBeTruthy();
    expect(screen.getByText(/proxy refused/)).toBeTruthy();
  });

  // ===== I-33：显式保存 + 脏状态 =====

  const saveButton = () => screen.getByRole("button", { name: /保\s*存|^Save$/ });

  it("什么都没改：保存禁用、没有「有未保存的更改」、测试连接可点", async () => {
    renderCard();
    await waitFor(() => expect(apiMocks.getNetworkSettings).toHaveBeenCalled());

    expect(saveButton()).toBeDisabled();
    expect(screen.queryByText(t("settingsUi.network.dirty"))).toBeNull();
    expect(screen.getByText(t("settingsUi.network.probe")).closest("button")).toBeEnabled();
  });

  it("改任一字段：保存启用 + 出现脏状态 + 测试连接被禁用并写明原因", async () => {
    renderCard();
    await waitFor(() => expect(apiMocks.getNetworkSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText(t("settingsUi.network.trust")));

    expect(saveButton()).toBeEnabled();
    expect(screen.getByText(t("settingsUi.network.dirty"))).toBeTruthy();
    expect(screen.getByText(t("settingsUi.network.probeBlocked"))).toBeTruthy();
    // 测试读的是**已保存**配置，脏状态下必须挡住，否则结论对不上。
    expect(screen.getByText(t("settingsUi.network.probe")).closest("button")).toBeDisabled();
  });

  it("保存成功后回到干净态：按钮禁用、提示消失、密码清空", async () => {
    renderCard();
    await waitFor(() => expect(apiMocks.getNetworkSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText(t("settingsUi.network.mode.custom")));
    fireEvent.change(screen.getByLabelText(t("settingsUi.network.password")), {
      target: { value: "secret" },
    });
    expect(saveButton()).toBeEnabled();

    fireEvent.click(saveButton());

    await waitFor(() => expect(apiMocks.saveNetworkSettings).toHaveBeenCalled());
    await waitFor(() => expect(saveButton()).toBeDisabled());
    expect(screen.queryByText(t("settingsUi.network.dirty"))).toBeNull();
    expect(screen.getByLabelText(t("settingsUi.network.password"))).toHaveValue("");
  });

  it("改设置后上一次的测试结果立刻消失（旧结论对应旧配置）", async () => {
    apiMocks.getLLMConfig.mockResolvedValue({ base_url: "https://api.deepseek.com", model: "x" });
    apiMocks.testLLM.mockResolvedValue({ ok: true, latency_ms: 10, message: "" });
    renderCard();
    await waitFor(() => expect(apiMocks.getNetworkSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText(t("settingsUi.network.probe")));
    await waitFor(() => expect(screen.getByTestId("network-probe-lines")).toBeTruthy());

    fireEvent.click(screen.getByLabelText(t("settingsUi.network.trust")));
    expect(screen.queryByTestId("network-probe-lines")).toBeNull();
  });

  it("检测提示与底部灰字互斥：关掉 Alert 后灰字才出现", async () => {
    // 这句是**后端下发的 notice**（不是界面文案，没有 i18n 键）：提成常量，
    // 免得 cjkRatchet 把 `getByText("…")` 里的中文当成新增的硬编码界面文案。
    const NOTICE = "已按系统代理出网";
    renderCard();
    await waitFor(() => expect(apiMocks.getNetworkSettings).toHaveBeenCalled());
    // BASE.notice 为空，这里换成有 notice 的响应，才能验证"两者不同时出现"。
    cleanup();
    apiMocks.getNetworkSettings.mockResolvedValue({ ...BASE, notice: NOTICE });
    renderCard();
    await waitFor(() => expect(screen.getByText(/127\.0\.0\.1:7890/)).toBeTruthy());

    expect(screen.queryByText(NOTICE)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.getByText(NOTICE)).toBeTruthy());
  });

  it("卡片吃到设置卡的统一间距类", async () => {
    renderCard();
    await waitFor(() => expect(apiMocks.getNetworkSettings).toHaveBeenCalled());
    expect(screen.getByTestId("network-proxy-card").className).toContain("settings-card");
  });
});
