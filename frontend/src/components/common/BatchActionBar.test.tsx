/** BatchActionBar：计数、操作区透传与退出。 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BatchActionBar from "./BatchActionBar";

describe("BatchActionBar", () => {
  it("显示已选计数并透传操作按钮", () => {
    const onExit = vi.fn();
    const onDelete = vi.fn();
    render(
      <BatchActionBar count={3} onExit={onExit}>
        <button type="button" onClick={onDelete}>
          删除所选
        </button>
      </BatchActionBar>,
    );

    expect(screen.getByText("已选 3 项")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除所选" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "退出多选" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
