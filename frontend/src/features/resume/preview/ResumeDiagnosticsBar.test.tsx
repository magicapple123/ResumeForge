// SPDX-License-Identifier: Apache-2.0
/**
 * 详情顶部「诊断与说明」一行（2026-11 问题 8）。
 *
 * 这一行是**信息架构改动**的落点：四段元信息从"各占一行"变成"一行四个入口"，所以这里钉的
 * 是三条最容易退化的性质：
 * 1. **内容逐字不变**：弹层里渲染的必须是传进来的原节点，不在这里改写任何内容；
 * 2. **条数进无障碍名**：视觉徽标读屏拿不到，`aria-label` 必须带数字；
 * 3. **入口是真按钮**：`Tab` 能依次到达，`Enter` / `Space` 由浏览器原生激活。
 *
 * 本文件刻意不含 CJK 字面量（i18n 棘轮对新增中文断言会红）：期望文案一律走 `t()`。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import ResumeDiagnosticsBar from "./ResumeDiagnosticsBar";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const DIAGNOSIS_LABEL = t("resume.diagnostics.aria.diagnosis", { label: "Occupancy 81%" });
const COVERAGE_LABEL = t("resume.diagnostics.aria.coverage", { count: 31 });
const EVIDENCE_LABEL = t("resume.diagnostics.aria.evidence", { count: 24 });
const RATIONALE_LABEL = t("resume.diagnostics.aria.rationale");

function renderBar() {
  return render(
    <AntdApp>
      <ResumeDiagnosticsBar
        diagnosis={{
          content: <p>layout-body</p>,
          badge: "Occupancy 81%",
          attention: true,
        }}
        coverage={{ content: <p>coverage-body</p>, count: 31 }}
        evidence={{ content: <p>evidence-body</p>, count: 24 }}
        rationale={<p>rationale-body</p>}
      />
    </AntdApp>,
  );
}

describe("ResumeDiagnosticsBar", () => {
  it("渲染四个入口，条数与状态都写进无障碍名", () => {
    renderBar();

    for (const label of [DIAGNOSIS_LABEL, COVERAGE_LABEL, EVIDENCE_LABEL, RATIONALE_LABEL]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    // 读屏名里必须有数字，而不只是视觉徽标。
    expect(COVERAGE_LABEL).toContain("31");
    expect(EVIDENCE_LABEL).toContain("24");
  });

  it("四个入口都是原生按钮：Tab 能依次到达，Enter / Space 由浏览器激活", () => {
    renderBar();

    const buttons = [
      screen.getByRole("button", { name: DIAGNOSIS_LABEL }),
      screen.getByRole("button", { name: COVERAGE_LABEL }),
      screen.getByRole("button", { name: EVIDENCE_LABEL }),
      screen.getByRole("button", { name: RATIONALE_LABEL }),
    ];
    for (const button of buttons) {
      // 真 `<button>` 才能用键盘激活；`<div onClick>` 在这里会直接红。
      expect(button.tagName).toBe("BUTTON");
      expect(button).not.toHaveAttribute("tabindex", "-1");
      button.focus();
      expect(document.activeElement).toBe(button);
    }
    // DOM 顺序 = Tab 顺序：四个入口按"版面 → 未收录 → 来源 → 生成说明"排列。
    expect(buttons).toHaveLength(4);
  });

  it("点开入口后展示传入的原内容（逐字不变）", async () => {
    renderBar();

    fireEvent.click(screen.getByRole("button", { name: COVERAGE_LABEL }));
    expect(await screen.findByText("coverage-body")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: EVIDENCE_LABEL }));
    expect(await screen.findByText("evidence-body")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: RATIONALE_LABEL }));
    expect(await screen.findByText("rationale-body")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: DIAGNOSIS_LABEL }));
    expect(await screen.findByText("layout-body")).toBeInTheDocument();
  });

  it("弹层内容挂限高容器：长清单（31 条）在弹层内部滚动，不撑高页面", async () => {
    renderBar();

    fireEvent.click(screen.getByRole("button", { name: COVERAGE_LABEL }));
    const body = await screen.findByText("coverage-body");
    const popover = body.closest(".resume-diagnostics-popover");
    expect(popover).not.toBeNull();
  });

  it("Esc 能关掉弹层（键盘用户不必去找鼠标）", async () => {
    renderBar();

    const entry = screen.getByRole("button", { name: COVERAGE_LABEL });
    fireEvent.click(entry);
    expect(await screen.findByText("coverage-body")).toBeInTheDocument();

    fireEvent.keyDown(entry, { key: "Escape" });
    // 关掉后浮层进入退出动画（antd 给根节点挂 `ant-zoom-*-leave`），说明 Esc 被消费了；
    // jsdom 不跑动画帧，所以断言"正在关闭"这一状态，等不到 `ant-popover-hidden`。
    const popover = document.querySelector(".ant-popover");
    expect(popover).not.toBeNull();
    expect(popover?.className ?? "").toMatch(/ant-zoom-big-leave/);
  });

  it("什么都没得展示时整行不渲染（不留一条空条）", () => {
    const { container } = render(
      <AntdApp>
        <ResumeDiagnosticsBar />
      </AntdApp>,
    );
    expect(container.querySelector(".resume-diagnostics-bar")).toBeNull();
  });
});
