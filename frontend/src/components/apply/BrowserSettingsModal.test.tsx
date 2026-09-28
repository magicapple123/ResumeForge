/**
 * 网申页的「浏览器设置」弹窗：读回现值、只改浏览器两个字端、整份提交。
 *
 * 重点守一条**曾经真实踩过的坑**：`GET /apply/config` 返回的是 `ApplyConfigOut`
 * （输入字段 + `defaults` 出厂默认值回显），而 `PUT` 收的是 `ApplyConfigIn`
 * （`extra="forbid"`）。把 GET 的响应体整个回传，后端会 422
 * 「Extra inputs are not permitted」——用户看到的现象是"点保存就报错"，
 * 而报错信息里既没有字段名也没有上下文，很难自己看出是哪个多出来的键。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplyConfig, ApplyConfigOut } from "../../types";
import BrowserSettingsModal from "./BrowserSettingsModal";

const apiMocks = vi.hoisted(() => ({
  getApplyConfig: vi.fn(),
  updateApplyConfig: vi.fn(),
}));

vi.mock("../../api/apply", async () => {
  const actual = await vi.importActual<typeof import("../../api/apply")>("../../api/apply");
  return {
    ...actual,
    getApplyConfig: apiMocks.getApplyConfig,
    updateApplyConfig: apiMocks.updateApplyConfig,
  };
});

/** 一份完整配置：改了浏览器字段之后，其余每一项都必须原样带回去（PUT 是整份覆盖）。 */
const CONFIG: ApplyConfig = {
  interval_seconds: 30,
  interval_jitter_seconds: 10,
  daily_limit: 50,
  per_task_limit: 20,
  breaker_threshold: 5,
  default_greeting: "您好，我想应聘这个岗位。",
  skip_same_company: true,
  confirm_real_gap: false,
  browser_port: 9333,
  browser_choice: "auto",
  browser_path: "",
  site_key: "boss",
};

/** GET 的响应在配置之外还多一个 `defaults` —— 它不是可提交的输入。 */
const CONFIG_OUT: ApplyConfigOut = {
  ...CONFIG,
  defaults: { ...CONFIG, browser_choice: "auto" },
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getApplyConfig.mockResolvedValue(CONFIG_OUT);
  apiMocks.updateApplyConfig.mockResolvedValue(CONFIG_OUT);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

async function openModal() {
  render(
    <AntdApp>
      <BrowserSettingsModal open onClose={vi.fn()} onSaved={vi.fn()} />
    </AntdApp>,
  );
  // 等 Skeleton 换成表单（配置取回之后才渲染字段）。
  await screen.findByRole("combobox");
}

describe("BrowserSettingsModal", () => {
  it("提交时**不带 `defaults`**——它是只读回显，后端会以「Extra inputs are not permitted」拒绝", async () => {
    await openModal();

    fireEvent.click(screen.getByRole("button", { name: "保 存" }));

    await waitFor(() => expect(apiMocks.updateApplyConfig).toHaveBeenCalled());
    const payload = apiMocks.updateApplyConfig.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("defaults");
  });

  it("整份提交：改浏览器不会把间隔、上限、招呼语、站点清空", async () => {
    await openModal();

    fireEvent.click(screen.getByRole("button", { name: "保 存" }));

    await waitFor(() => expect(apiMocks.updateApplyConfig).toHaveBeenCalled());
    const payload = apiMocks.updateApplyConfig.mock.calls[0][0] as ApplyConfig;
    // PUT 是整份覆盖，漏掉任何一项都会把它重置成默认值。
    expect(payload.interval_seconds).toBe(30);
    expect(payload.daily_limit).toBe(50);
    expect(payload.default_greeting).toBe("您好，我想应聘这个岗位。");
    expect(payload.site_key).toBe("boss");
    expect(payload.browser_port).toBe(9333);
  });

  it("切成 Edge 保存时，`browser_choice` 真的带上了 edge", async () => {
    await openModal();

    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByTitle("Microsoft Edge"));
    fireEvent.click(screen.getByRole("button", { name: "保 存" }));

    await waitFor(() => expect(apiMocks.updateApplyConfig).toHaveBeenCalled());
    const payload = apiMocks.updateApplyConfig.mock.calls[0][0] as ApplyConfig;
    expect(payload.browser_choice).toBe("edge");
    expect(payload).not.toHaveProperty("defaults");
  });

  it("保存失败时如实报错，不静默关闭弹窗", async () => {
    apiMocks.updateApplyConfig.mockRejectedValue(new Error("Extra inputs are not permitted"));
    const onClose = vi.fn();
    render(
      <AntdApp>
        <BrowserSettingsModal open onClose={onClose} onSaved={vi.fn()} />
      </AntdApp>,
    );
    await screen.findByRole("combobox");

    fireEvent.click(screen.getByRole("button", { name: "保 存" }));

    expect(await screen.findByText("Extra inputs are not permitted")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
