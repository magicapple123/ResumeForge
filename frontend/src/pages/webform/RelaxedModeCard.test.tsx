/**
 * 放宽模式快捷入口卡。
 *
 * 守两条：风险文案常驻（不是只在开启瞬间提醒一次）；开关状态来自后端设置
 * （mock 掉取数层，断言 UI 忠实反映状态与保存意图）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App as AntApp } from "antd";

// vi.mock 会被提升到文件顶部，工厂在静态导入期执行——可变状态必须经 vi.hoisted
// 携带，否则 `enabledMock` 还在 TDZ 里。
const mocks = vi.hoisted(() => ({
  enabled: (): boolean => false,
  toggle: vi.fn(),
}));

vi.mock("../../features/settings/useWebFormRelaxedMode", () => ({
  useWebFormRelaxedMode: () => ({
    enabled: mocks.enabled(),
    loading: false,
    saving: false,
    toggle: mocks.toggle,
    reload: vi.fn(),
  }),
}));

import { RelaxedModeCard } from "./RelaxedModeCard";

function renderCard() {
  return render(
    <AntApp>
      <RelaxedModeCard />
    </AntApp>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.enabled = () => false;
});

describe("RelaxedModeCard", () => {
  beforeEach(() => {
    mocks.enabled = () => false;
  });

  it("风险文案常驻，开启状态下额外说明当前行为", () => {
    const { rerender } = renderCard();
    expect(screen.getAllByText(/存在选错可能/).length).toBeGreaterThan(0);

    mocks.enabled = () => true;
    rerender(
      <AntApp>
        <RelaxedModeCard />
      </AntApp>,
    );
    expect(screen.getAllByText(/存在选错可能/).length).toBeGreaterThan(0);
    expect(screen.getByText(/已开启/)).toBeTruthy();
  });

  it("切换开关会保存并把用户意图传给后端设置", async () => {
    mocks.toggle.mockResolvedValue(true);
    renderCard();

    fireEvent.click(screen.getByRole("switch", { name: "网申填表放宽模式" }));
    await waitFor(() => expect(mocks.toggle).toHaveBeenCalledWith(true));
  });
});
