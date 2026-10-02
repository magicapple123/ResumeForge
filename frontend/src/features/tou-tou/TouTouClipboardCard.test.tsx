import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TouTouClipboardCard from "./TouTouClipboardCard";
import { copyText } from "../../utils/clipboard";

vi.mock("../../utils/clipboard", () => ({
  copyText: vi.fn(),
}));

const STORAGE_KEY = "resumeforge.toutou.clipboard.v1";

function seedStorage(items: unknown) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

/** 组件用 App.useApp() 取 message：渲染必须包在 AntdApp 里。 */
function renderCard(ui: React.ReactElement) {
  return render(<AntdApp>{ui}</AntdApp>);
}

describe("TouTouClipboardCard", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(copyText).mockReset();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("renders nothing while closed", () => {
    renderCard(<TouTouClipboardCard open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog", { name: "投投剪贴板" })).toBeNull();
  });

  it("shows the empty state when nothing is stored", () => {
    renderCard(<TouTouClipboardCard open onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "投投剪贴板" })).toBeInTheDocument();
    expect(screen.getByText("还没有片段：把常贴的内容存进来，随时一键复制。")).toBeInTheDocument();
  });

  it("creates a snippet and persists it to localStorage", () => {
    renderCard(<TouTouClipboardCard open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /新增片段/ }));
    fireEvent.change(screen.getByPlaceholderText(/片段名称/), {
      target: { value: "自我介绍" },
    });
    fireEvent.change(screen.getByPlaceholderText(/片段内容/), {
      target: { value: "你好，我是一名前端工程师。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保 存" }));

    expect(screen.getByText("自我介绍")).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].title).toBe("自我介绍");
    expect(stored[0].content).toBe("你好，我是一名前端工程师。");
  });

  it("copies a snippet to the system clipboard", async () => {
    seedStorage([{ id: 1, title: "联系方式", content: "13800000000" }]);
    vi.mocked(copyText).mockResolvedValue(true);
    renderCard(<TouTouClipboardCard open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "复 制" }));

    await waitFor(() => {
      expect(copyText).toHaveBeenCalledWith("13800000000");
    });
    expect(await screen.findByText("已复制「联系方式」")).toBeInTheDocument();
  });

  it("deletes a snippet after confirmation", async () => {
    seedStorage([{ id: 1, title: "联系方式", content: "13800000000" }]);
    renderCard(<TouTouClipboardCard open onClose={vi.fn()} />);

    // 删除收进了「···」菜单：打开菜单 → 点删除 → 确认（无 locale 时确认键是 "OK"）。
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(await screen.findByText("删除"));
    fireEvent.click(await screen.findByRole("button", { name: "OK" }));

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")).toHaveLength(0);
    });
  });

  it("re-positions next to the orb on every open instead of restoring the last drag", () => {
    function openAndDrag() {
      const view = renderCard(<TouTouClipboardCard open onClose={vi.fn()} />);
      const grip = document.querySelector<HTMLDivElement>(".tt-clipboard-card-grip")!;
      fireEvent.pointerDown(grip, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
      fireEvent.pointerMove(window, { clientX: 140, clientY: 160, pointerId: 1 });
      fireEvent.pointerUp(window, { clientX: 140, clientY: 160, pointerId: 1 });
      view.unmount();
    }

    stubOrbAt(900, 500, "right");
    openAndDrag();
    const dragged = document.querySelector<HTMLElement>(".tt-clipboard-card");
    expect(dragged).toBeNull(); // 已卸载，拖动位置只活在被卸载的实例里

    // 重开（组件重建）：不恢复上一次拖动的位置，重新按球位置摆到球旁边。
    renderCard(<TouTouClipboardCard open onClose={vi.fn()} />);
    const card = document.querySelector<HTMLElement>(".tt-clipboard-card")!;
    // 球贴右 → 卡片在球左侧（left = 900 - 360 - 12 = 528）。
    expect(card.style.left).toBe("528px");
  });
});

/** stub 一个指定位置的悬浮球（球被拖到哪，卡片就该跟到哪旁边）。 */
function stubOrbAt(left: number, top: number, edge: "left" | "right" | "top" | "bottom") {
  let shell = document.querySelector<HTMLElement>(".tt-shell");
  if (!shell) {
    shell = document.createElement("div");
    shell.className = `tt-shell is-edge-${edge}`;
    const orb = document.createElement("button");
    orb.className = "tt";
    shell.appendChild(orb);
    document.body.appendChild(shell);
  } else {
    shell.className = `tt-shell is-edge-${edge}`;
  }
  const orb = shell.querySelector<HTMLElement>(".tt")!;
  orb.getBoundingClientRect = () =>
    ({ left, top, width: 64, height: 64, right: left + 64, bottom: top + 64 }) as DOMRect;
}
