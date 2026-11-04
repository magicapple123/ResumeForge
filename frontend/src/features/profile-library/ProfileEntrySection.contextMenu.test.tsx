// SPDX-License-Identifier: Apache-2.0
/**
 * 资料库条目的右键加速通道（问题 26b）。
 *
 * 条目右侧三个图标按钮保留（判据 2：右键只能是加速器，不能是唯一入口）；右键只是
 * "不用瞄准 16px 图标"的第二个入口，所以这里钉的是**两处行为完全一致**：
 * 上移/下移的禁用条件同源、删除走同一条 handler。
 */
import { App as AntdApp, Form } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { makeField, makeSection } from "../../test/profileWorkspaceFixture";
import type { FieldOut, SectionOut } from "./types";
import ProfileEntrySection from "./ProfileEntrySection";

const SECTION_KEY = "custom:abc";

function customSection(): SectionOut {
  return makeSection(SECTION_KEY, "Custom", "multi", [makeField(SECTION_KEY, "name", "Name")], {
    is_builtin: false,
  });
}

function Harness({
  onRemoveEntry = vi.fn(),
  editing = true,
}: {
  onRemoveEntry?: (sectionKey: string, entryKey: string, title: string) => void;
  editing?: boolean;
}) {
  const [form] = Form.useForm();
  const section = customSection();
  return (
    <AntdApp>
      <Form
        form={form}
        initialValues={{
          sections: {
            [section.key]: ["Alpha", "Beta", "Gamma"].map((value, index) => ({
              entry_key: `entry-${index}`,
              values: { [section.fields[0].field_id]: value },
            })),
          },
        }}
      >
        <ProfileEntrySection
          section={section}
          editing={editing}
          saving={false}
          entryLimit={20}
          singleLineMax={200}
          multiLineMax={2000}
          onRequestEdit={vi.fn()}
          onAddEntry={vi.fn()}
          onRemoveEntry={onRemoveEntry}
          onSetPreference={vi.fn<(field: FieldOut, patch: { hidden?: boolean }) => void>()}
          onOpenGuide={vi.fn()}
        />
      </Form>
    </AntdApp>
  );
}

/** 可见字段输入框的值（按卡片顺序）。 */
function values(): string[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="text"]'))
    .filter((input) => input.closest(".ant-form-item-hidden") === null)
    .map((input) => input.value);
}

function cards(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".profile-list-item"));
}

function menuItems() {
  return screen.getAllByRole("menuitem");
}

/**
 * 按文案取菜单项：antd 的菜单项里图标是 `role="img" aria-label="arrow-up"`，
 * 可访问名会变成「arrow-up 上移这一条」，按 name 精确匹配会落空。
 */
function menuItem(label: string): HTMLElement {
  const found = menuItems().find((node) => node.textContent === label);
  if (!found) throw new Error(`menu item not found: ${label}`);
  return found;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("资料库条目右键（26b）", () => {
  it("右键条目弹出三项，与图标按钮同名", async () => {
    render(<Harness />);
    fireEvent.contextMenu(cards()[1], { clientX: 40, clientY: 50 });

    await waitFor(() => expect(screen.getByRole("menu")).toBeInTheDocument());
    expect(menuItems().map((node) => node.textContent)).toEqual([
      t("profileLibrary.entry.moveUp"),
      t("profileLibrary.entry.moveDown"),
      t("profileLibrary.entry.remove"),
    ]);
  });

  it("上移在第一条禁用、下移在最后一条禁用——与按钮同源", async () => {
    render(<Harness />);

    fireEvent.contextMenu(cards()[0], { clientX: 10, clientY: 10 });
    await waitFor(() => expect(screen.getByRole("menu")).toBeInTheDocument());
    expect(menuItem(t("profileLibrary.entry.moveUp"))).toHaveAttribute("aria-disabled", "true");
    expect(menuItem(t("profileLibrary.entry.moveDown"))).toHaveAttribute("aria-disabled", "false");
    // 按钮那一侧是同一份判断：第一条的上移按钮同样禁用。
    expect(
      screen.getAllByRole("button", { name: t("profileLibrary.entry.moveUp") })[0],
    ).toBeDisabled();
  });

  it("菜单里的「上移」与点图标按钮效果一致", async () => {
    render(<Harness />);
    fireEvent.contextMenu(cards()[2], { clientX: 10, clientY: 10 });
    await waitFor(() => expect(screen.getByRole("menu")).toBeInTheDocument());

    fireEvent.click(menuItem(t("profileLibrary.entry.moveUp")));
    await waitFor(() => expect(values()).toEqual(["Alpha", "Gamma", "Beta"]));
  });

  it("菜单里的「删除」走与图标按钮同一条 handler", async () => {
    const onRemoveEntry = vi.fn();
    render(<Harness onRemoveEntry={onRemoveEntry} />);
    fireEvent.contextMenu(cards()[0], { clientX: 10, clientY: 10 });
    await waitFor(() => expect(screen.getByRole("menu")).toBeInTheDocument());

    fireEvent.click(menuItem(t("profileLibrary.entry.remove")));
    expect(onRemoveEntry).toHaveBeenCalledWith(SECTION_KEY, "entry-0", "1");
  });

  it("查看态不接管右键（三项此刻都不可执行）", () => {
    render(<Harness editing={false} />);
    expect(fireEvent.contextMenu(cards()[0], { clientX: 10, clientY: 10 })).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
