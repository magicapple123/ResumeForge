// SPDX-License-Identifier: Apache-2.0
/**
 * 问题 14：编辑器提示条的两条路径与按 tone 自动消失。
 *
 * - 有宿主：portal 到宿主节点（中栏底部、滚动容器之外），DOM 父级必须是宿主；
 * - 没宿主：回退成流内渲染（生成预览等场景），仍然能出现、仍然能点 × 关闭；
 * - 自动消失：`info` 2.5s、`warning` 8s，且"同一句文案再来一次"要重新读秒。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DocumentNotice, { NOTICE_AUTO_DISMISS_MS } from "./DocumentNotice";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
});

describe("DocumentNotice", () => {
  it("有宿主时 portal 到宿主节点（不在流内渲染）", () => {
    const host = document.createElement("div");
    host.className = "resume-wb-notice-host";
    document.body.appendChild(host);
    render(
      <div className="document-editor">
        <DocumentNotice
          notice={{ text: "已添加条目", tone: "info" }}
          host={host}
          onDismiss={() => {}}
        />
      </div>,
    );
    const alert = screen.getByRole("alert");
    const layer = alert.closest(".document-editor-notice") as HTMLElement;
    expect(layer.parentElement).toBe(host);
    expect(layer.getAttribute("data-notice-tone")).toBe("info");
    expect(document.querySelector(".document-editor")?.contains(layer)).toBe(false);
    host.remove();
  });

  it("没有宿主时回退成流内渲染（不能「没 host 就不渲染」）", () => {
    render(
      <div className="document-editor">
        <DocumentNotice notice={{ text: "已添加条目", tone: "info" }} onDismiss={() => {}} />
      </div>,
    );
    const layer = screen.getByRole("alert").closest(".document-editor-notice") as HTMLElement;
    expect(layer.parentElement?.className).toContain("document-editor");
    // 回退路径的间距仍由 document-editor.css 的 margin-top 提供。
    expect(layer.className).toContain("document-editor-notice");
  });

  it("info 提示 2.5 秒后自动消失，warning 8 秒", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <DocumentNotice notice={{ text: "已添加条目", tone: "info" }} onDismiss={onDismiss} />,
    );
    act(() => {
      vi.advanceTimersByTime(NOTICE_AUTO_DISMISS_MS.info - 100);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    onDismiss.mockClear();
    rerender(
      <DocumentNotice notice={{ text: "不能放到这里", tone: "warning" }} onDismiss={onDismiss} />,
    );
    act(() => {
      vi.advanceTimersByTime(NOTICE_AUTO_DISMISS_MS.info + 100);
    });
    // warning 比 info 长：跑到 info 的时长还不该消失。
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(NOTICE_AUTO_DISMISS_MS.warning);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("同一句文案再来一次会重新读秒（不是沿用剩余时间）", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <DocumentNotice notice={{ text: "已移动", tone: "info" }} onDismiss={onDismiss} />,
    );
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // 新对象、同一句话：重置计时。
    rerender(<DocumentNotice notice={{ text: "已移动", tone: "info" }} onDismiss={onDismiss} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("notice 变成 null 时清除计时器并卸载提示", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <DocumentNotice notice={{ text: "已移动", tone: "info" }} onDismiss={onDismiss} />,
    );
    rerender(<DocumentNotice notice={null} onDismiss={onDismiss} />);
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(NOTICE_AUTO_DISMISS_MS.warning);
    });
    // 提示已经没了，旧的定时器不能把"下一条提示"关掉。
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("× 仍然可以提前关掉", () => {
    const onDismiss = vi.fn();
    render(
      <DocumentNotice notice={{ text: "不能放到这里", tone: "warning" }} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
