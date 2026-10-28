// SPDX-License-Identifier: Apache-2.0
/**
 * 用户反馈 #6（2026-10-28）：「我的资料」自建板块的条目名称此前同步首个单行字段内容
 * （如「法国色色」「瑞典人」），希望条目名只显示序号 1/2/3。
 *
 * 这里钉住三条性质：
 * 1. 自建板块的卡片标题 = 纯序号（按当前顺序），**不跟随字段内容**；
 * 2. 改字段值不影响标题；上移/下移后序号按**位置**重排（内容跟着走、序号不跟内容走）；
 * 3. 系统板块不受影响：标题仍是公司 / 学校 / 项目名（回归保护）。
 *
 * 夹具文案用 ASCII：这些是测试数据、不是产品文案（cjkRatchet 的 tests 口径）。
 */
import { App as AntdApp, Form } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { makeField, makeSection } from "../../test/profileWorkspaceFixture";
import type { FieldOut, SectionOut } from "./types";
import ProfileEntrySection from "./ProfileEntrySection";

const CUSTOM_KEY = "custom:abc";

function customSection(): SectionOut {
  return makeSection(CUSTOM_KEY, "Custom", "multi", [makeField(CUSTOM_KEY, "name", "Name")], {
    is_builtin: false,
  });
}

function builtinSection(): SectionOut {
  return makeSection("educations", "Education", "multi", [
    makeField("educations", "school", "School"),
  ]);
}

interface HarnessProps {
  section: SectionOut;
  values: string[];
}

function Harness({ section, values }: HarnessProps) {
  const [form] = Form.useForm();
  return (
    <AntdApp>
      <Form
        form={form}
        initialValues={{
          sections: {
            [section.key]: values.map((value, index) => ({
              entry_key: "entry-" + index,
              values: { [section.fields[0].field_id]: value },
            })),
          },
        }}
      >
        <ProfileEntrySection
          section={section}
          editing
          saving={false}
          entryLimit={20}
          singleLineMax={200}
          multiLineMax={2000}
          onRequestEdit={vi.fn()}
          onAddEntry={vi.fn()}
          onRemoveEntry={vi.fn()}
          onSetPreference={vi.fn<(field: FieldOut, patch: { hidden?: boolean }) => void>()}
          onOpenGuide={vi.fn()}
        />
      </Form>
    </AntdApp>
  );
}

/** 每张卡片标题的文本（自建板块 = 序号，系统板块 = 字段值）。 */
function cardTitles(): string[] {
  return Array.from(document.querySelectorAll(".profile-list-item-title")).map(
    (node) => node.textContent ?? "",
  );
}

/** 可见的字段输入框（排除 `Form.Item hidden` 里的 entry_key 隐藏输入）。 */
function fieldInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="text"]')).filter(
    (input) => input.closest(".ant-form-item-hidden") === null,
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("自建板块 · 条目名称只显示序号", () => {
  it("标题 = 1/2/3 纯序号，不显示字段内容", () => {
    render(<Harness section={customSection()} values={["Alpha", "Beta"]} />);
    expect(cardTitles()).toEqual(["1", "2"]);
    // 字段内容仍在输入框里（只是不再被当作标题）。
    expect(fieldInputs().map((input) => input.value)).toEqual(["Alpha", "Beta"]);
    expect(cardTitles()).not.toContain("Alpha");
  });

  it("改字段值后标题不变（序号不跟随内容）", () => {
    render(<Harness section={customSection()} values={["Alpha", "Beta"]} />);
    const first = fieldInputs()[0];
    fireEvent.change(first, { target: { value: "France" } });
    expect(first.value).toBe("France");
    expect(cardTitles()).toEqual(["1", "2"]);
  });

  it("上移第二条：序号按位置重排（首条标题仍是 1，内容变成 Beta）", () => {
    render(<Harness section={customSection()} values={["Alpha", "Beta"]} />);
    const upButtons = screen.getAllByRole("button", {
      name: t("profileLibrary.entry.moveUp"),
    });
    fireEvent.click(upButtons[1]);

    // 序号按当前位置现算：两张卡片仍是 1、2，但第一条的内容已经换成 Beta。
    expect(cardTitles()).toEqual(["1", "2"]);
    expect(fieldInputs().map((input) => input.value)).toEqual(["Beta", "Alpha"]);
  });

  it("系统板块不受影响：标题仍是首个单行字段的值", () => {
    render(<Harness section={builtinSection()} values={["Tsinghua"]} />);
    expect(cardTitles()).toEqual(["Tsinghua"]);
  });
});
