// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑操作条（需求 6）的单元契约：什么时候出现、两颗按钮接的是不是页面给的动作。
 *
 * 页面级"点保存真的落库"由 ProfilePage.editBar.test.tsx 端到端钉；这里只保证组件本身
 * 不越权——它不持有任何保存逻辑，只把 `onSave` / `onCancel` 转出去。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { looseButtonName } from "../../test/profilePageHarness";
import ProfileEditActionBar from "./ProfileEditActionBar";

afterEach(() => {
  cleanup();
});

function renderBar(overrides: Partial<Parameters<typeof ProfileEditActionBar>[0]> = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(
    <ProfileEditActionBar
      editing
      dirty
      saving={false}
      onSave={onSave}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onSave, onCancel };
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: looseButtonName(t("profileLibrary.editBar.save")) });
}

function cancelButton(): HTMLElement {
  return screen.getByRole("button", { name: looseButtonName(t("profileLibrary.editBar.cancel")) });
}

describe("ProfileEditActionBar", () => {
  it("编辑且有改动时才出现", () => {
    render(
      <ProfileEditActionBar
        editing
        dirty={false}
        saving={false}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("profile-edit-bar")).toBeNull();
    cleanup();

    render(
      <ProfileEditActionBar
        editing={false}
        dirty
        saving={false}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("profile-edit-bar")).toBeNull();
    cleanup();

    render(
      <ProfileEditActionBar editing dirty saving={false} onSave={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByTestId("profile-edit-bar")).toBeInTheDocument();
  });

  it("两颗按钮各自转到页面给的动作（组件自己不保存也不重置）", () => {
    const { onSave, onCancel } = renderBar();
    fireEvent.click(saveButton());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(cancelButton());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("保存中：主按钮进加载态、取消禁用（请求途中不能把表单关掉）", () => {
    renderBar({ saving: true });
    expect(saveButton()).toHaveClass("ant-btn-loading");
    expect(cancelButton()).toBeDisabled();
  });

  it("保存被暂时拦住时（照片读取/识别中）两颗按钮都禁用", () => {
    const { onSave, onCancel } = renderBar({ blocked: true });
    fireEvent.click(saveButton());
    fireEvent.click(cancelButton());
    expect(saveButton()).toBeDisabled();
    expect(cancelButton()).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
