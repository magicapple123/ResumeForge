// SPDX-License-Identifier: Apache-2.0
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DetailTrigger } from "./RecordDetail";

afterEach(cleanup);

describe("detail card interactions", () => {
  it("has sibling controls rather than nested buttons and keeps each action independent", () => {
    const open = vi.fn();
    const edit = vi.fn();
    render(
      <DetailTrigger label="查看资料详情" onOpen={open}>
        <div>卡片正文</div>
        <button type="button" onClick={edit}>
          编辑资料
        </button>
      </DetailTrigger>,
    );
    const details = screen.getByRole("button", { name: "查看资料详情" });
    const editButton = screen.getByRole("button", { name: "编辑资料" });
    expect(editButton.parentElement?.closest('button, [role="button"]')).toBeNull();
    fireEvent.click(editButton);
    expect(edit).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("卡片正文"));
    fireEvent.keyDown(details, { key: "Enter" });
    fireEvent.keyDown(details, { key: " " });
    expect(open).toHaveBeenCalledTimes(3);
  });
});
