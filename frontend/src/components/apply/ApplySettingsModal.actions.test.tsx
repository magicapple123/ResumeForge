// SPDX-License-Identifier: Apache-2.0
/**
 * 投递设置弹窗的底部操作条（2026-10-20）。
 *
 * 这个表单有七八个字段，原来「取消 / 保存设置」跟在最后一个字段后面，用户改到中间
 * 想保存得先滚到底。现在改成 **sticky 在滚动区底部、靠右**。
 *
 * jsdom 不求值布局，所以两件事分开钉：
 * 1. DOM：操作条单独成块、里面就是这两个按钮（不再混在 Form 的字段流里）；
 * 2. CSS：那条规则确实是 `position: sticky` + 右对齐，且背景用弹窗面颜色
 *    （否则滚过去的字段会从按钮下面透出来）。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { App as AntdApp } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplyConfig, ApplyConfigOut } from "../../types";
import ApplySettingsModal from "./ApplySettingsModal";

declare const process: { cwd(): string };

const apiMocks = vi.hoisted(() => ({
  getApplyConfig: vi.fn(),
  updateApplyConfig: vi.fn(),
  listSites: vi.fn(),
}));

vi.mock("../../api/apply", async () => {
  const actual = await vi.importActual<typeof import("../../api/apply")>("../../api/apply");
  return {
    ...actual,
    getApplyConfig: apiMocks.getApplyConfig,
    updateApplyConfig: apiMocks.updateApplyConfig,
    listSites: apiMocks.listSites,
  };
});

const CONFIG: ApplyConfig = {
  interval_seconds: 30,
  interval_jitter_seconds: 10,
  daily_limit: 50,
  per_task_limit: 20,
  breaker_threshold: 5,
  default_greeting: "您好，我想应聘这个岗位。",
  skip_same_company: true,
  confirm_real_gap: false,
  site_key: "boss",
  browser_choice: "auto",
  browser_path: "",
  browser_port: 9333,
};

const OUT: ApplyConfigOut = { ...CONFIG, defaults: CONFIG };

function renderModal() {
  return render(
    <AntdApp>
      <ApplySettingsModal open onClose={() => {}} />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.getApplyConfig.mockResolvedValue(OUT);
  apiMocks.listSites.mockResolvedValue({ sites: [{ key: "boss", display_name: "BOSS直聘" }] });
  apiMocks.updateApplyConfig.mockResolvedValue(OUT);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ApplySettingsModal 底部操作条", () => {
  it("取消 / 保存设置单独成块，且不放在表单字段流里", async () => {
    renderModal();

    const save = await screen.findByRole("button", { name: /保存设置/ });
    const actions = save.closest(".apply-settings-actions") as HTMLElement;
    expect(actions).not.toBeNull();
    // antd 会在两个中文字之间插空格（「取 消」），比较前先去掉空白。
    expect((actions.textContent ?? "").replace(/\s/g, "")).toContain("取消保存设置");
    // 操作条是表单的最后一个子节点：视觉上永远在底部。
    const form = actions.closest("form");
    expect(form).not.toBeNull();
    expect(form!.lastElementChild).toBe(actions);
  });

  it("CSS 里是 sticky + 靠右 + 弹窗面底色", () => {
    const css = readFileSync([process.cwd(), "src", "styles", "apply.css"].join("/"), "utf8");
    const block = /\.apply-settings-actions\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(block).toContain("position: sticky");
    expect(block).toContain("bottom: 0");
    expect(block).toContain("justify-content: flex-end");
    expect(block).toContain("background: var(--rf-surface)");
  });
});
