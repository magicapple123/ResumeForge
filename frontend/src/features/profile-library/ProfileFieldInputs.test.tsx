// SPDX-License-Identifier: Apache-2.0
/**
 * ProfileFieldInputs（F6/Q）：字段一律渲染（不再有「更多字段 / 收起更多字段」折叠）；
 * 用户隐藏的字段只从恢复清单回来；照片不走文本输入。
 *
 * 2026-10-27 用户要求去掉折叠入口（"隐藏就够了"）：服务端 FieldOut 仍可能带
 * default_collapsed / collapsed_override（DTO 兼容），本组件不读它们。
 */
import { App as AntdApp, Form } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import ProfileFieldInputs from "./ProfileFieldInputs";
import { ProfileBaselineContext } from "../profile/profileBaselineContext";
import { makeField, makeSection } from "../../test/profileWorkspaceFixture";
import type { FieldOut, SectionOut } from "./types";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const SECTION: SectionOut = makeSection("basic_info", "Basic Info", "singleton", [
  makeField("basic_info", "name", "Name"),
  makeField("basic_info", "nickname", "Nickname", { default_collapsed: true }),
  makeField("basic_info", "secret", "Secret", { hidden: true }),
  makeField("basic_info", "photo", "Photo", { field_type: "photo" }),
]);

function Harness({
  section,
  onSetPreference,
  disabled,
}: {
  section: SectionOut;
  onSetPreference: (field: FieldOut, patch: { hidden?: boolean }) => void;
  disabled?: boolean;
}) {
  const [form] = Form.useForm();
  return (
    <AntdApp>
      <Form
        form={form}
        initialValues={{
          sections: {
            basic_info: [
              {
                entry_key: "entry-1",
                values: {
                  "basic_info.name": "Alice",
                  "basic_info.nickname": "Ali",
                  "basic_info.secret": "hidden-value",
                },
              },
            ],
          },
        }}
      >
        {/* 与生产一致：entry_key 必须注册进表单，"已修改"标记要靠它找到基线。 */}
        <Form.Item name={["sections", "basic_info", 0, "entry_key"]} hidden>
          <input type="hidden" />
        </Form.Item>
        <ProfileFieldInputs
          section={section}
          namePrefix={["sections", "basic_info", 0, "values"]}
          singleLineMax={200}
          multiLineMax={2000}
          onSetPreference={onSetPreference}
          disabled={disabled}
        />
        <Form.Item shouldUpdate noStyle>
          {() => (
            <span data-testid="name-value">
              {String(
                form.getFieldValue(["sections", "basic_info", 0, "values", "basic_info.name"]) ??
                  "",
              )}
            </span>
          )}
        </Form.Item>
      </Form>
    </AntdApp>
  );
}

describe("ProfileFieldInputs 的字段渲染与隐藏", () => {
  it("默认收起的字段也始终渲染，且没有折叠入口", () => {
    const onSetPreference = vi.fn();
    render(<Harness section={SECTION} onSetPreference={onSetPreference} />);

    // nickname 在服务端定义里是 default_collapsed=true，界面不再折叠：直接渲染。
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.getByText("Nickname")).toBeInTheDocument();
    expect(screen.getByLabelText("Nickname")).toHaveValue("Ali");
    // 照片输入走专门入口；隐藏字段不渲染。
    expect(screen.queryByText("Photo")).not.toBeInTheDocument();
    expect(screen.queryByText("Secret")).not.toBeInTheDocument();
    // 整块只剩「已隐藏 1 个字段」这一个按钮：没有「更多字段 / 收起更多字段」出口。
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(onSetPreference).not.toHaveBeenCalled();
  });

  it("服务端残留的折叠偏好不再影响渲染（两份偏好都不读）", () => {
    const section = makeSection("basic_info", "Basic Info", "singleton", [
      makeField("basic_info", "name", "Name"),
      makeField("basic_info", "folded_default", "Folded default", { default_collapsed: true }),
      makeField("basic_info", "folded_on", "Folded on", {
        default_collapsed: true,
        collapsed_override: true,
      }),
      makeField("basic_info", "folded_off", "Folded off", {
        default_collapsed: true,
        collapsed_override: false,
      }),
    ]);
    render(<Harness section={section} onSetPreference={vi.fn()} />);

    expect(screen.getAllByRole("textbox")).toHaveLength(4);
    // 没有隐藏字段时整块没有任何按钮（旧版会有「收起更多字段」）。
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("隐藏字段只从恢复清单回来，且恢复写 hidden=false", () => {
    const onSetPreference = vi.fn();
    render(<Harness section={SECTION} onSetPreference={onSetPreference} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: t("profileLibrary.field.hiddenList", { count: 1 }),
      }),
    );
    expect(screen.getByText("Secret")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("profileLibrary.field.restore") }));
    const [field, patch] = onSetPreference.mock.calls[0];
    expect((field as FieldOut).key).toBe("secret");
    expect(patch).toEqual({ hidden: false });
  });

  it("单行文本进多列网格；只有多行文本整行（日期与短字段同格），行距收紧", () => {
    const gridSection = makeSection("basic_info", "Basic Info", "singleton", [
      makeField("basic_info", "name", "Name"),
      makeField("basic_info", "nickname", "Nickname"),
      makeField("basic_info", "bio", "Bio", { field_type: "multi_line" }),
      makeField("basic_info", "start", "Start", { field_type: "date_text" }),
    ]);
    render(<Harness section={gridSection} onSetPreference={vi.fn()} />);

    const grid = document.querySelector(".profile-field-grid");
    expect(grid).not.toBeNull();
    // 四个字段都在网格里，DOM 顺序 = 字段顺序。
    const items = grid!.querySelectorAll(":scope > .profile-field-grid-item");
    expect(items).toHaveLength(4);
    // 只有多行文本占整行。日期不再整行：年/月/日三个下拉收在一格里，
    // 「姓名 / 性别 / 出生年月」「开始 / 结束」才能落在同一行。
    const wide = grid!.querySelectorAll(":scope > .profile-field-grid-item.is-wide");
    expect(wide).toHaveLength(1);
    expect(screen.getByLabelText("Bio").closest(".profile-field-grid-item")).toHaveClass("is-wide");
    expect(screen.getByLabelText("Start").closest(".profile-field-grid-item")).not.toHaveClass(
      "is-wide",
    );
    expect(screen.getByLabelText("Name").closest(".profile-field-grid-item")).not.toHaveClass(
      "is-wide",
    );
    // 行间边距收紧（antd 默认 24px）。
    const formItem = grid!.querySelector(".profile-field-grid-item .ant-form-item") as HTMLElement;
    expect(formItem.style.marginBottom).toBe("12px");
  });

  it("「至今」只给区间的结束端：出生年月没有勾选框，结束时间有", () => {
    // 回归：「所有 date_text 都传 allowOngoing」让「出生年月」长出「至今」勾选框，
    // 而它是个点日期；勾上再取消还会把原值吞成空（见 PartialDateSelect 的用例）。
    const dates = makeSection("basic_info", "Basic Info", "singleton", [
      makeField("basic_info", "birth_month", "出生年月", { field_type: "date_text" }),
      makeField("basic_info", "awarded_at", "获奖时间", { field_type: "date_text" }),
      makeField("educations", "start_date", "开始时间", { field_type: "date_text" }),
      makeField("educations", "end_date", "结束时间", { field_type: "date_text" }),
    ]);
    render(<Harness section={dates} onSetPreference={vi.fn()} />);

    const item = (label: string) =>
      screen.getByLabelText(label).closest(".profile-field-grid-item") as HTMLElement;
    const hasOngoing = (label: string) =>
      item(label).querySelector(".profile-partial-date-select__ongoing") !== null;

    // 只有结束时间是区间的结束端。
    expect(hasOngoing("结束时间")).toBe(true);
    expect(hasOngoing("出生年月")).toBe(false);
    expect(hasOngoing("获奖时间")).toBe(false);
    expect(hasOngoing("开始时间")).toBe(false);
    expect(screen.getAllByRole("checkbox", { name: "至今" })).toHaveLength(1);
  });

  it("自建小字段没有 end_date 约定，标签写「结束 / 截止」时才给「至今」", () => {
    const custom = makeSection("basic_info", "Basic Info", "singleton", [
      makeField("basic_info", "custom_deadline", "截止时间", { field_type: "date_text" }),
      makeField("basic_info", "custom_birth", "出生年月", { field_type: "date_text" }),
    ]);
    render(<Harness section={custom} onSetPreference={vi.fn()} />);

    expect(screen.getAllByRole("checkbox", { name: "至今" })).toHaveLength(1);
  });

  it("编辑态：只有相对已保存基线改过的字段带 is-dirty", () => {
    const onSetPreference = vi.fn();
    // 基线里 name=Alice、nickname=Ali；下面把 nickname 改成 Bob。
    const baseline = { "basic_info.name": "Alice", "basic_info.nickname": "Ali" };
    render(
      <ProfileBaselineContext.Provider
        value={(entryKey) => (entryKey === "entry-1" ? baseline : null)}
      >
        <Harness section={SECTION} onSetPreference={onSetPreference} />
      </ProfileBaselineContext.Provider>,
    );

    // 刚打开时没有改动：一个 is-dirty 都不该有。
    expect(document.querySelectorAll(".profile-field-grid-item.is-dirty")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Nickname"), { target: { value: "Bob" } });

    const dirty = document.querySelectorAll(".profile-field-grid-item.is-dirty");
    expect(dirty).toHaveLength(1);
    // 标出来的是昵称那一格，不是姓名那一格。
    expect(dirty[0].textContent).toContain("Nickname");
    expect(dirty[0].textContent).not.toContain("Name");

    // 改回原值就不再算"已修改"。
    fireEvent.change(screen.getByLabelText("Nickname"), { target: { value: "Ali" } });
    expect(document.querySelectorAll(".profile-field-grid-item.is-dirty")).toHaveLength(0);
  });

  it("只读态（disabled）不标已修改", () => {
    const onSetPreference = vi.fn();
    render(
      <ProfileBaselineContext.Provider value={() => ({ "basic_info.name": "Alice" })}>
        <Harness section={SECTION} onSetPreference={onSetPreference} disabled />
      </ProfileBaselineContext.Provider>,
    );
    expect(document.querySelectorAll(".profile-field-grid-item.is-dirty")).toHaveLength(0);
  });
});
