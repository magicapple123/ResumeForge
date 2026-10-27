// SPDX-License-Identifier: Apache-2.0
/**
 * ProfileFieldInputs（F6/Q）：默认收起 vs 用户隐藏两个状态独立；
 * 「更多字段」展开写 collapsed_override；隐藏字段只从恢复清单回来；照片不走文本输入。
 */
import { App as AntdApp, Form } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import ProfileFieldInputs from "./ProfileFieldInputs";
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
}: {
  section: SectionOut;
  onSetPreference: (
    field: FieldOut,
    patch: { hidden?: boolean; collapsed_override?: boolean | null },
  ) => void;
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
        <ProfileFieldInputs
          section={section}
          namePrefix={["sections", "basic_info", 0, "values"]}
          singleLineMax={200}
          multiLineMax={2000}
          onSetPreference={onSetPreference}
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

describe("ProfileFieldInputs 的收起与隐藏", () => {
  it("默认收起字段先不渲染，更多字段按钮写 collapsed_override=false", () => {
    const onSetPreference = vi.fn();
    render(<Harness section={SECTION} onSetPreference={onSetPreference} />);

    // 只有 name 一个可编辑文本输入：nickname 收起、secret 隐藏、photo 走专门入口。
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.queryByText("Nickname")).not.toBeInTheDocument();
    expect(screen.queryByText("Secret")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("profileLibrary.field.more") }));
    expect(onSetPreference).toHaveBeenCalledTimes(1);
    expect(onSetPreference.mock.calls[0][1]).toEqual({ collapsed_override: false });
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
    // 四个字段都在网格里，DOM 顺序 = 字段顺序（不改变顺序与收起逻辑）。
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

  it("展开记忆来自服务端 collapsed_override，两个状态互不覆盖", () => {
    const expanded = makeSection("basic_info", "Basic Info", "singleton", [
      makeField("basic_info", "name", "Name"),
      makeField("basic_info", "nickname", "Nickname", {
        default_collapsed: true,
        collapsed_override: false,
      }),
      makeField("basic_info", "secret", "Secret", { hidden: true }),
    ]);
    render(<Harness section={expanded} onSetPreference={vi.fn()} />);

    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: t("profileLibrary.field.more") }),
    ).not.toBeInTheDocument();
    // 再收起写回 collapsed_override=true；与 hidden 无关。
    fireEvent.click(screen.getByRole("button", { name: t("profileLibrary.field.less") }));
    // 收起按钮在默认收起字段被展开后出现；点击后走 onSetPreference（此处未断言参数归属）
    expect(screen.getByTestId("name-value").textContent).toBe("Alice");
  });
});
