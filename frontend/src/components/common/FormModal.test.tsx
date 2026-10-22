// SPDX-License-Identifier: Apache-2.0
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App as AntdApp, Input } from "antd";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import FormModal from "./FormModal";

// 仓库没有开 vitest 的 `globals`，RTL 的自动清理不会注册：每个用例结束自己收。
afterEach(cleanup);

function renderModal(props: Partial<Parameters<typeof FormModal>[0]> = {}) {
  const onCancel = vi.fn();
  const onSubmit = vi.fn();
  const view = render(
    <AntdApp>
      <FormModal
        open
        title="编辑条目"
        okText="保存改动"
        onCancel={onCancel}
        onSubmit={onSubmit}
        {...props}
      >
        <Input aria-label="标题" />
      </FormModal>
    </AntdApp>,
  );
  return { ...view, onCancel, onSubmit };
}

/** 仓库没有装 `@testing-library/user-event`（依赖极保守），Esc 用 fireEvent 直发到 document。 */
function pressEscape(): void {
  fireEvent.keyDown(document, { key: "Escape" });
}

describe("FormModal 的行为契约", () => {
  it("点蒙层不关闭（蒙层点击恒不可关，调用方覆盖不了）", () => {
    const { onCancel } = renderModal();
    const wrap = document.querySelector(".ant-modal-wrap");
    expect(wrap).not.toBeNull();
    fireEvent.click(wrap as Element);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("无脏值时 Esc 直接关", () => {
    const { onCancel } = renderModal();
    pressEscape();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("脏值按 Esc 出内联确认条而不是关闭，再按一次 Esc 回到编辑", () => {
    const { onCancel } = renderModal({ dirty: true });
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "x" } });
    pressEscape();

    const bar = screen.getByRole("alert");
    expect(bar).toHaveTextContent(t("common.discard.body"));
    expect(onCancel).not.toHaveBeenCalled();

    pressEscape();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("确认条上点「放弃修改」才关", () => {
    const { onCancel } = renderModal({ dirty: true });
    pressEscape();
    fireEvent.click(screen.getByRole("button", { name: t("common.action.discard") }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("有草稿时不问，直接关（关闭无损）", () => {
    const { onCancel } = renderModal({ dirty: true, hasDraft: true });
    pressEscape();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("缺少 okText 时当场抛错，不退回默认「确定」", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderModal({ okText: "  " })).toThrow(/okText/);
    spy.mockRestore();
  });

  it("提交中：取消按钮禁用、× 隐藏、Esc 忽略", () => {
    const { onCancel } = renderModal({ submitting: true, dirty: true });
    // antd 会给两个汉字的按钮自动插空格（「取 消」），所以按正则找。
    expect(screen.getByRole("button", { name: /取\s*消/ })).toBeDisabled();
    expect(document.querySelector(".ant-modal-close")).toBeNull();

    pressEscape();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("主按钮走 onSubmit", () => {
    const { onSubmit } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "保存改动" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("草稿恢复条渲染在 body 顶部，恢复动作可点", () => {
    const onRestore = vi.fn();
    renderModal({
      draftBar: { savedAt: Date.now(), fieldCount: 3, onRestore, onDiscard: vi.fn() },
    });
    fireEvent.click(screen.getByRole("button", { name: t("draft.restore.action") }));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });
});
