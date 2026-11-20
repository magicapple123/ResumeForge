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

  it("检测条与底部灰字互斥：有检测条时不出灰字，点「改为直连」后改成直连", async () => {
    // 这句是**后端下发的 notice**（不是界面文案，没有 i18n 键）：提成常量，
    // 免得 cjkRatchet 把 `getByText("…")` 里的中文当成新增的硬编码界面文案。
    const NOTICE = "已按系统代理出网";
    apiMocks.getNetworkSettings.mockResolvedValue({ ...BASE, notice: NOTICE });
    renderCard();
    await waitFor(() => expect(screen.getByTestId("network-detected")).toBeTruthy());

    expect(screen.queryByText(NOTICE)).toBeNull();
    // 状态条不再有"关掉就算了"的 ×：它给的是出路，不是一句可以遮住的提示。
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t("settingsUi.network.useDirect") }));
    expect(screen.queryByTestId("network-detected")).toBeNull();
    // 切成直连后，灰字（只在非直连时出现的那句）也不该冒出来。
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  // ===== R3-05：单选卡 / 状态条动作 / 工具栏 =====

  const directCard = () => screen.getByTestId("network-mode-direct");
  const customCard = () => screen.getByTestId("network-mode-custom");
  const urlInput = () => screen.queryByLabelText(t("settingsUi.network.url"));

  it("三档是 radiogroup 里的三张单选项，选中态由 aria-checked 表达", async () => {
    renderCard();
    await waitFor(() => expect(apiMocks.getNetworkSettings).toHaveBeenCalled());

    expect(screen.getByRole("radiogroup")).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByTestId("network-mode-system")).toHaveAttribute("aria-checked", "true");
    expect(directCard()).toHaveAttribute("aria-checked", "false");
    expect(customCard()).toHaveAttribute("aria-checked", "false");
    // 每张卡自带一句说明：裸单选不自解释。
    expect(screen.getByText(t("settingsUi.network.mode.systemHint"))).toBeTruthy();
  });

  /**
   * 状态条的动作必须**真的切换选中项**。这条用例是它的守卫：
   * 去掉 `onClick` 里的 `selectMode("direct")` 后，`aria-checked` 会停在 false、保存仍禁用，
   * 三处断言同时变红（已实测）。
   */
  it("点「改为直连」把选中项切成直连，并让保存可用", async () => {
    renderCard();
    await waitFor(() => expect(apiMocks.getNetworkSettings).toHaveBeenCalled());
    expect(directCard()).toHaveAttribute("aria-checked", "false");
    expect(saveButton()).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: t("settingsUi.network.useDirect") }));

    expect(directCard()).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("network-mode-system")).toHaveAttribute("aria-checked", "false");
    expect(saveButton()).toBeEnabled();
    expect(screen.getByText(t("settingsUi.network.dirty"))).toBeTruthy();
  });

  it("方向键在单选项之间移动，并把焦点带过去", async () => {
    renderCard();
    await waitFor(() => expect(apiMocks.getNetworkSettings).toHaveBeenCalled());

    const system = screen.getByTestId("network-mode-system");
    system.focus();
    fireEvent.keyDown(system, { key: "ArrowRight" });
    expect(directCard()).toHaveAttribute("aria-checked", "true");
    expect(directCard()).toHaveFocus();

    fireEvent.keyDown(directCard(), { key: "ArrowLeft" });
    expect(system).toHaveAttribute("aria-checked", "true");
    expect(system).toHaveFocus();
  });

  it("选自定义代理时地址框出现并拿到焦点，切走再切回填的内容还在", async () => {
    renderCard();
    await waitFor(() => expect(apiMocks.getNetworkSettings).toHaveBeenCalled());
    expect(urlInput()).toBeNull();

    fireEvent.click(customCard());
    await waitFor(() => expect(urlInput()).toHaveFocus());

    fireEvent.change(urlInput()!, { target: { value: "http://127.0.0.1:7890" } });
    fireEvent.click(screen.getByTestId("network-mode-system"));
    expect(urlInput()).toBeNull();

    fireEvent.click(customCard());
    expect(urlInput()).toHaveValue("http://127.0.0.1:7890");
  });

  it("开关行整行可点：点标签也能切，且一次点击只翻一次", async () => {
    renderCard();
    await waitFor(() => expect(apiMocks.getNetworkSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByText(t("settingsUi.network.trust")));
    expect(screen.getByLabelText(t("settingsUi.network.trust"))).toBeChecked();

    // 点控件本身不能既走 onChange 又走行点击，否则等于没点。
    fireEvent.click(screen.getByLabelText(t("settingsUi.network.trust")));
    expect(screen.getByLabelText(t("settingsUi.network.trust"))).not.toBeChecked();
  });

  it("工具栏常驻「没有改动」，保存成功后从脏状态回到它", async () => {
    renderCard();
    await waitFor(() => expect(apiMocks.getNetworkSettings).toHaveBeenCalled());
    expect(screen.getByText(t("settingsUi.network.clean"))).toBeTruthy();

    fireEvent.click(screen.getByLabelText(t("settingsUi.network.trust")));
    expect(screen.queryByText(t("settingsUi.network.clean"))).toBeNull();
    expect(screen.getByText(t("settingsUi.network.dirty"))).toBeTruthy();

    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByText(t("settingsUi.network.clean"))).toBeTruthy());
  });

  it("卡片吃到设置卡的统一间距类", async () => {
    renderCard();
    await waitFor(() => expect(apiMocks.getNetworkSettings).toHaveBeenCalled());
    expect(screen.getByTestId("network-proxy-card").className).toContain("settings-card");
  });
});
