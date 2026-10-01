import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TouTouAssistantCard from "./TouTouAssistantCard";

afterEach(() => cleanup());

describe("TouTouAssistantCard", () => {
  it("keeps the floating assistant dialog separate and closable", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <TouTouAssistantCard open onClose={onClose}>
        <div>投投对话内容</div>
      </TouTouAssistantCard>,
    );

    expect(screen.getByRole("dialog", { name: "投投求职助手" })).toBeInTheDocument();
    expect(screen.getByText("投投对话内容")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭投投助手" }));
    expect(onClose).toHaveBeenCalledOnce();

    rerender(
      <TouTouAssistantCard open={false} onClose={onClose}>
        <div>投投对话内容</div>
      </TouTouAssistantCard>,
    );
    expect(screen.queryByRole("dialog", { name: "投投求职助手" })).not.toBeInTheDocument();
  });
});
