import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ShortcutSettingsCard from "./ShortcutSettingsCard";
import { SHORTCUT_STORAGE_KEY } from "../../features/shortcuts/storage";
import { setShortcutRecording } from "../../features/shortcuts/useShortcutKeymap";

function renderCard() {
  return render(
    <AntdApp>
      <ShortcutSettingsCard />
    </AntdApp>,
  );
}

function storedBindings(): Record<string, string[]> | null {
  const raw = window.localStorage.getItem(SHORTCUT_STORAGE_KEY);
  if (raw === null) return null;
  return (JSON.parse(raw) as { bindings: Record<string, string[]> }).bindings;
}

/** 某个动作所在的那一行（antd 的 Table 另有测量行，按文字定位最稳）。 */
function rowOf(label: string): HTMLElement {
  const cell = screen.getByText(label);
  const row = cell.closest("tr");
  if (!row) throw new Error(`没找到「${label}」所在的行`);
  return row;
}

function startRecording(label: string) {
  fireEvent.click(within(rowOf(label)).getByRole("button", { name: /修\s*改/ }));
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  setShortcutRecording(false);
});

describe("ShortcutSettingsCard", () => {
  it("列出六个动作、作用域与默认组合", () => {
    renderCard();
    for (const label of ["撤回", "恢复", "保存当前编辑", "搜索", "打开/关闭求职助手", "新建岗位"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText("Ctrl+Z").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ctrl+Shift+Z").length).toBeGreaterThan(0);
    // 默认状态下每一行的「恢复默认」都不可点。
    for (const label of ["撤回", "搜索"]) {
      expect(
        within(rowOf(label)).getByRole("button", { name: /恢\s*复\s*默\s*认/ }),
      ).toBeDisabled();
    }
  });

  it("录制新组合后写入 localStorage 并刷新显示", async () => {
    renderCard();
    startRecording("撤回");
    expect(await screen.findByText("请按下新组合，Esc 取消")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "p", ctrlKey: true });

    await waitFor(() => expect(storedBindings()?.undo).toEqual(["mod+p"]));
    // 录制结束、标签换成新组合。
    await waitFor(() => expect(screen.queryByText("请按下新组合，Esc 取消")).toBeNull());
    expect(within(rowOf("撤回")).getByText("Ctrl+P")).toBeInTheDocument();
  });

  it("与其它动作冲突时红字提示且不落库", async () => {
    renderCard();
    startRecording("撤回");
    // Ctrl+K 是「搜索」的默认组合。
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(await screen.findByText("已被「搜索」占用")).toBeInTheDocument();
    expect(storedBindings()).toBeNull();
    // 仍在录制态，等用户换一个组合。
    expect(screen.getByText("请按下新组合，Esc 取消")).toBeInTheDocument();
  });

  it("拒绝浏览器保留组合与无修饰键字母", async () => {
    renderCard();
    startRecording("撤回");

    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    expect(await screen.findByText("这是浏览器或窗口的保留组合，换一个")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "z" });
    expect(await screen.findByText("组合键必须带 Ctrl / ⌘ 或 Alt")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    expect(storedBindings()).toBeNull();
  });

  it("Esc 取消录制且不落库", async () => {
    renderCard();
    startRecording("搜索");
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByText("请按下新组合，Esc 取消")).toBeNull());
    expect(storedBindings()).toBeNull();
    expect(within(rowOf("搜索")).getByText("Ctrl+K")).toBeInTheDocument();
  });

  it("单行「恢复默认」把该动作改回默认组合", async () => {
    renderCard();
    startRecording("搜索");
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    await waitFor(() => expect(storedBindings()?.search).toEqual(["mod+p"]));

    fireEvent.click(within(rowOf("搜索")).getByRole("button", { name: /恢\s*复\s*默\s*认/ }));

    await waitFor(() => expect(storedBindings()?.search).toEqual(["mod+k"]));
    expect(within(rowOf("搜索")).getByText("Ctrl+K")).toBeInTheDocument();
  });

  it("「全部恢复默认」需要二次确认", async () => {
    renderCard();
    startRecording("搜索");
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    await waitFor(() => expect(storedBindings()?.search).toEqual(["mod+p"]));

    fireEvent.click(screen.getByRole("button", { name: /全部恢复默认/ }));
    const confirm = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>(".ant-popconfirm .ant-btn-primary");
      if (!button) throw new Error("未找到确认按钮");
      return button;
    });
    fireEvent.click(confirm);

    await waitFor(() => expect(storedBindings()?.search).toEqual(["mod+k"]));
  });
});
