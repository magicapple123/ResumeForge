import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetNavigationVisibilityForTests } from "../../utils/navigationVisibility";
import NavigationSettingsCard from "./NavigationSettingsCard";

const apiMocks = vi.hoisted(() => ({
  getNavigationVisibility: vi.fn(),
  saveNavigationVisibility: vi.fn(),
}));

vi.mock("../../api/settings", () => apiMocks);

function renderCard() {
  return render(
    <AntdApp>
      <NavigationSettingsCard />
    </AntdApp>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetNavigationVisibilityForTests();
  apiMocks.getNavigationVisibility.mockResolvedValue({ hidden: [] });
  apiMocks.saveNavigationVisibility.mockImplementation(async (hidden: string[]) => ({ hidden }));
});

afterEach(() => {
  cleanup();
  resetNavigationVisibilityForTests();
  document.body.innerHTML = "";
});

describe("NavigationSettingsCard", () => {
  it("允许隐藏可选模块，但核心入口始终固定显示", async () => {
    renderCard();

    const assistant = await screen.findByRole("switch", { name: "求职助手导航入口" });
    const home = screen.getByRole("switch", { name: "首页导航入口" });
    expect(assistant).toBeChecked();
    expect(home).toBeChecked();
    expect(home).toBeDisabled();

    fireEvent.click(assistant);

    await waitFor(() =>
      expect(apiMocks.saveNavigationVisibility).toHaveBeenCalledWith(["/assistant"]),
    );
    expect(assistant).not.toBeChecked();
  });

  it("可以一次恢复所有可选模块的默认显示", async () => {
    apiMocks.getNavigationVisibility.mockResolvedValue({ hidden: ["/assistant", "/analytics"] });
    renderCard();

    expect(await screen.findByRole("switch", { name: "求职助手导航入口" })).not.toBeChecked();
    // 卡片挂载时会异步拉取可见性配置，loading 期间按钮是 disabled 的，React 会吞掉
    // disabled 按钮上的 click（Linux CI 上 mock 解析慢于下面的点击，此前把用例打挂）；
    // 等按钮真正可用再点，断言本身不变。
    const resetBtn = screen.getByRole("button", { name: "恢复默认显示" });
    await waitFor(() => expect(resetBtn).toBeEnabled());
    fireEvent.click(resetBtn);

    await waitFor(() => expect(apiMocks.saveNavigationVisibility).toHaveBeenCalledWith([]));
    expect(screen.getByRole("switch", { name: "求职助手导航入口" })).toBeChecked();
  });
});
