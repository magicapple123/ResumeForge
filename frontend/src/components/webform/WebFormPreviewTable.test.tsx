/**
 * 预览表的放宽模式状态语义。
 *
 * 「放宽代选」与「需你确认」只在放宽模式开启时出现（后端默认关）：前者要标明
 * 程序将代点，后者**必须**让"默认不勾、勾上即视为本人确认"这件事在界面上读得出来
 * ——勾上它等于代你做出表态，视觉上不能和事实类混在一起。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WebFormPreviewItem } from "../../types";
import WebFormPreviewTable from "./WebFormPreviewTable";

function item(overrides: Partial<WebFormPreviewItem>): WebFormPreviewItem {
  return {
    index: 0,
    field: "target_city",
    field_label: "期望工作地点",
    value: "天津",
    control_label: "意向城市",
    control_type: "text",
    status: "ready",
    current_value: "",
    options: [],
    note: "",
    source: "rule",
    ...overrides,
  };
}

afterEach(cleanup);

describe("WebFormPreviewTable 的放宽模式状态", () => {
  it("relaxed_ready 行标「放宽代选」并带核对提醒", () => {
    render(
      <WebFormPreviewTable
        items={[item({ status: "relaxed_ready", note: "放宽模式：程序将代点，填完请核对" })]}
        selected={new Set([0])}
        values={{}}
        onToggle={() => {}}
        onValueChange={() => {}}
      />,
    );

    expect(screen.getByText("放宽代选")).toBeTruthy();
    expect(screen.getByText(/程序将代点/)).toBeTruthy();
  });

  it("needs_confirm 行标「需你确认」，样式与文案都区别于事实类", () => {
    render(
      <WebFormPreviewTable
        items={[
          item({
            index: 1,
            field: "",
            field_label: "我已阅读并同意隐私政策",
            value: "我已阅读并同意隐私政策",
            control_type: "checkbox",
            status: "needs_confirm",
            note: "同意/声明类：默认不勾，你勾选后才由程序代点",
          }),
        ]}
        selected={new Set()}
        values={{}}
        onToggle={() => {}}
        onValueChange={() => {}}
      />,
    );

    expect(screen.getByText("需你确认")).toBeTruthy();
    expect(screen.getByText(/默认不勾/)).toBeTruthy();
    // 淡警示底色行（区别于事实类）。
    const row = screen.getByText("需你确认").closest("tr");
    expect(row?.className).toContain("webform-row-needs-confirm");
  });
});
