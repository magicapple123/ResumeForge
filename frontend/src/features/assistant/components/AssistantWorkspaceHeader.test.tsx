// SPDX-License-Identifier: Apache-2.0
/**
 * F34 临时对话：会话标题区的「本次不记忆」开关。
 *
 * 三条：草稿态（`memoryOff` 缺省）不渲染开关；关着时点一下要求打开；
 * 开着时如实反映 —— 开关只切换偏好，不碰已有记忆。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import AssistantWorkspaceHeader from "./AssistantWorkspaceHeader";

function renderHeader(overrides: Partial<React.ComponentProps<typeof AssistantWorkspaceHeader>>) {
  return render(
    <AssistantWorkspaceHeader
      compact={false}
      historyOpen={false}
      onToggleHistory={vi.fn()}
      selecting={false}
      selectedIds={new Set<number>()}
      removeSelected={vi.fn()}
      exitSelecting={vi.fn()}
      title="cache debugging"
      {...overrides}
    />,
  );
}

afterEach(cleanup);

describe("AssistantWorkspaceHeader 本次不记忆开关（F34）", () => {
  it("草稿态（没有会话）不渲染开关", () => {
    renderHeader({});
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("关着时点一下要求打开", () => {
    const onMemoryOffChange = vi.fn();
    renderHeader({ memoryOff: false, onMemoryOffChange });

    const toggle = screen.getByRole("switch", { name: t("assistantUi.memory.off") });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    // antd Switch 的 onChange 还带一个 event 参数，只关心第一个：新值。
    expect(onMemoryOffChange.mock.calls[0]?.[0]).toBe(true);
  });

  it("开着时按钮处于选中态", () => {
    renderHeader({ memoryOff: true, onMemoryOffChange: vi.fn() });
    expect(screen.getByRole("switch", { name: t("assistantUi.memory.off") })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
