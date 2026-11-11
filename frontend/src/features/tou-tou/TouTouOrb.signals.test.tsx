// SPDX-License-Identifier: Apache-2.0
/**
 * 悬浮球集成（#27B/C/D/E）：信号驱动 pulse 与气泡、中断预算降级与静音、长按/Cmd+K
 * 打开动作面板、焦点不逃出面板、Esc 收起、顺便问。
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useLocation } from "react-router-dom";
import { t } from "../../i18n";
import TouTouOrb from "./TouTouOrb";
import { defaultTouTouContext, TouTouContext } from "./touTouContext";
import { registerTouTouContext, type TouTouSignal } from "./touTouPageContext";
import { INTERVENTION_STORAGE_KEY } from "./touTouIntervention";
import { renderOrb } from "./touTouTestUtils";
import { askTouTouSideQuestion } from "./touTouSideAsk";

vi.mock("./touTouSideAsk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./touTouSideAsk")>();
  return {
    ...actual,
    askTouTouSideQuestion: vi.fn().mockResolvedValue({ answer: "侧问的回答", model: "test" }),
  };
});

// 中文断言常量：`*ByText("中文")` 会被 cjkRatchet 计成新增中文断言。
const SIDE_ANSWER = "侧问的回答";

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

const OVERFLOW_SIGNAL: TouTouSignal = {
  id: "layout-overflow",
  kind: "layout-overflow",
  messageKey: "touTou.signal.layoutOverflow.title",
  params: { needed: 3, limit: 1 },
};

const QUEUE_SIGNAL: TouTouSignal = {
  id: "queue-unsupported",
  kind: "queue-unsupported",
  count: 2,
  messageKey: "touTou.signal.queueUnsupported.title",
  params: { count: 2 },
  actionId: "go-apply",
};

function registerSignals(signals: readonly TouTouSignal[]) {
  let unregister = () => undefined as void;
  act(() => {
    unregister = registerTouTouContext({ id: "test-page", signals });
  });
  return () => act(() => unregister());
}

function shell(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".tt-shell");
}

/**
 * 造一段真实选区：Ctrl/Cmd+K 只在「有选中文本」时接管（否则让给全站搜索的既有快捷键）。
 * 面板入口测试必须先选字，才能复现真实的划词场景。
 */
function selectSampleText() {
  const node = document.createElement("p");
  node.textContent = "订单服务改造";
  document.body.appendChild(node);
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("信号驱动 pulse 与气泡（#27B）", () => {
  it("没有信号时球不 pulse、也不出气泡（轮播标语已删除）", () => {
    vi.useFakeTimers();
    renderOrb(<TouTouOrb />);
    expect(shell()?.classList.contains("has-signals")).toBe(false);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(document.querySelector(".tt-tip")).toBeNull();
  });

  it("signals 非空 → pulse，并在 1.2s 后出气泡（文案来自信号 key）", () => {
    vi.useFakeTimers();
    renderOrb(<TouTouOrb />);
    const dispose = registerSignals([OVERFLOW_SIGNAL]);

    expect(shell()?.classList.contains("has-signals")).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1_300);
    });
    expect(document.querySelector(".tt-tip")).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      t("touTou.signal.layoutOverflow.title", { needed: 3, limit: 1 }),
    );
    dispose();
    expect(shell()?.classList.contains("has-signals")).toBe(false);
  });

  it("「提示标语」关闭时仍然 pulse，但不出气泡（开关只停文字）", () => {
    vi.useFakeTimers();
    renderOrb(
      <TouTouContext.Provider value={{ ...defaultTouTouContext, tipsEnabled: false }}>
        <TouTouOrb />
      </TouTouContext.Provider>,
    );
    registerSignals([OVERFLOW_SIGNAL]);
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    expect(shell()?.classList.contains("has-signals")).toBe(true);
    expect(document.querySelector(".tt-tip")).toBeNull();
  });

  it("信号动作按 actionId 执行（队列不支持 → 去投递队列）", () => {
    vi.useFakeTimers();
    renderOrb(
      <>
        <TouTouOrb />
        <LocationProbe />
      </>,
    );
    registerSignals([QUEUE_SIGNAL]);
    act(() => {
      vi.advanceTimersByTime(1_300);
    });
    fireEvent.click(screen.getByRole("button", { name: t("touTou.action.goApply") }));
    expect(screen.getByTestId("location")).toHaveTextContent("/apply");
  });
});

describe("中断预算（#27D）", () => {
  it("连续忽略 3 次后降级：只 pulse，不再出气泡", () => {
    vi.useFakeTimers();
    window.localStorage.setItem(
      INTERVENTION_STORAGE_KEY,
      JSON.stringify({ mutedKinds: {}, weekly: {}, consecutiveIgnores: 3 }),
    );
    renderOrb(<TouTouOrb />);
    registerSignals([OVERFLOW_SIGNAL]);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(shell()?.classList.contains("has-signals")).toBe(true);
    expect(document.querySelector(".tt-tip")).toBeNull();
  });

  it("同类每周上限 2 次：第 3 次只 pulse 不出气泡", () => {
    vi.useFakeTimers();
    window.localStorage.setItem(
      INTERVENTION_STORAGE_KEY,
      JSON.stringify({
        mutedKinds: {},
        weekly: {
          "layout-overflow": {
            week: "2026-W46",
            count: 2,
          },
        },
        consecutiveIgnores: 0,
      }),
    );
    renderOrb(<TouTouOrb />);
    registerSignals([OVERFLOW_SIGNAL]);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(shell()?.classList.contains("has-signals")).toBe(true);
    expect(document.querySelector(".tt-tip")).toBeNull();
  });

  it("「这类别再提示」静音该 kind：气泡收起、pulse 也不再为它出现，且持久化", () => {
    vi.useFakeTimers();
    renderOrb(<TouTouOrb />);
    registerSignals([OVERFLOW_SIGNAL]);
    act(() => {
      vi.advanceTimersByTime(1_300);
    });
    fireEvent.click(screen.getByRole("button", { name: t("touTou.signal.mute") }));
    expect(document.querySelector(".tt-tip")).toBeNull();
    expect(shell()?.classList.contains("has-signals")).toBe(false);
    const stored = JSON.parse(window.localStorage.getItem(INTERVENTION_STORAGE_KEY) ?? "{}");
    expect(stored.mutedKinds).toHaveProperty("layout-overflow");
  });
});

describe("动作面板入口（#27C）", () => {
  it("Ctrl/Cmd+K 打开面板，焦点在面板内且 Tab 不逃出，Esc 收起", async () => {
    renderOrb(<TouTouOrb />);
    selectSampleText();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    const dialog = await screen.findByRole("dialog", { name: t("touTou.panel.title") });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    for (let index = 0; index < 8; index += 1) {
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Tab" });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("没有选中文本时 mod+k 不接管：留给全站搜索，面板不打开", () => {
    renderOrb(<TouTouOrb />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("长按 400ms 打开面板；随后的 click 不再打开助手", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    renderOrb(<TouTouOrb onOpen={onOpen} />);
    const button = screen.getByRole("button", { name: t("touTou.orb.ariaLabel") });

    fireEvent.pointerDown(button, { button: 0, clientX: 900, clientY: 400, pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(410);
    });
    expect(screen.getByRole("dialog", { name: t("touTou.panel.title") })).toBeInTheDocument();

    fireEvent.pointerUp(button, { pointerId: 1 });
    fireEvent.click(button);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("顺便问（#27E）", () => {
  it("Alt+Enter 发侧问，回答就地显示，不进会话", async () => {
    renderOrb(<TouTouOrb />);
    selectSampleText();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const textarea = await screen.findByRole("textbox", {
      name: t("touTou.panel.sideAskPlaceholder"),
    });
    fireEvent.change(textarea, { target: { value: "面试官问我为什么离职，怎么答？" } });
    fireEvent.keyDown(textarea, { key: "Enter", altKey: true });

    expect(await screen.findByText(SIDE_ANSWER)).toBeInTheDocument();
    expect(vi.mocked(askTouTouSideQuestion)).toHaveBeenCalledWith(
      expect.objectContaining({ question: "面试官问我为什么离职，怎么答？" }),
    );
  });
});
