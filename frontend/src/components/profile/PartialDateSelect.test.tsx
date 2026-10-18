import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Form } from "antd";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PartialDateSelect from "./PartialDateSelect";
import { buildYearGroups, normalizePartialDate } from "./partialDate";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

/** 渲染并返回年/月/日三个 Select 根元素（antd 禁用态挂在 .ant-select 上）。 */
function renderAndGetSelects(jsx: ReactNode) {
  render(jsx);
  return Array.from(
    document.querySelectorAll<HTMLElement>(".profile-partial-date-select .ant-select"),
  );
}

describe("PartialDateSelect", () => {
  it("把历史日期写法规范成可保存的短横线格式，并保留部分精度", () => {
    expect(normalizePartialDate("2024.6")).toBe("2024-06");
    expect(normalizePartialDate("2024年6月15日")).toBe("2024-06-15");
    expect(normalizePartialDate("2024")).toBe("2024");
    expect(normalizePartialDate("至今")).toBe("至今");
  });

  it("提供年、月、日三个选择框，并支持至今选项", () => {
    render(<PartialDateSelect label="教育日期" allowOngoing />);

    expect(document.querySelector(".profile-partial-date-select__controls")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "教育日期年份" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "教育日期月份" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "教育日期日期" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "至今" })).toBeInTheDocument();
  });

  it("未传 disabled 且 Form 级禁用（DisabledContext=true）时：选择框跟随上下文禁用", () => {
    // 回归：组件此前把 disabled prop 默认成 false 并恒传布尔值，antd Select 的合并
    // 规则（customDisabled ?? contextDisabled）会让显式 false 覆盖 Form 级禁用——
    // 「我的资料」非编辑态下日期控件仍可修改。未传时必须保持 undefined。
    const selects = renderAndGetSelects(
      <Form disabled>
        <PartialDateSelect label="出生日期" />
      </Form>,
    );
    expect(selects.length).toBe(3);
    for (const select of selects) {
      expect(select).toHaveClass("ant-select-disabled");
    }
  });

  it("未传 disabled 且 DisabledContext=false 时：选择框保持可选", () => {
    // 回归：组件此前把 disabled prop 默认成 false 并恒传布尔值，antd Select 的合并
    // 规则（customDisabled ?? contextDisabled）会让显式 false 覆盖 Form 级禁用——
    // 「我的资料」非编辑态下日期控件仍可修改。未传时必须保持 undefined。
    // value 选到年月：年/月/日三个框自身都没有禁用理由。
    const selects = renderAndGetSelects(
      <Form>
        <PartialDateSelect label="出生日期" value="2024-06" />
      </Form>,
    );
    expect(selects.length).toBe(3);
    for (const select of selects) {
      expect(select).not.toHaveClass("ant-select-disabled");
    }
  });

  it("显式传 disabled=true 时保持原有禁用行为", () => {
    const selects = renderAndGetSelects(<PartialDateSelect label="出生日期" disabled />);
    for (const select of selects) {
      expect(select).toHaveClass("ant-select-disabled");
    }
    expect(screen.getByRole("combobox", { name: "出生日期年份" })).toBeDisabled();
  });

  it("「至今」只锁年月日选择框，不额外禁用别的组件", () => {
    render(<PartialDateSelect label="工作日期" value="至今" allowOngoing />);
    for (const select of document.querySelectorAll<HTMLElement>(
      ".profile-partial-date-select .ant-select",
    )) {
      expect(select).toHaveClass("ant-select-disabled");
    }
    // 「至今」勾选框自身不受 selected.ongoing 影响（disabled 只由显式 prop 决定）。
    expect(screen.getByRole("checkbox", { name: "至今" })).toBeEnabled();
  });
});

describe("PartialDateSelect 年份分组（R9）", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("两组：第一组第一项是当前年，未来年份退到第二组", () => {
    // 回归：原来下拉是从「当前年+15」开始降序的，选出生年份要先滚过十几个未来年份。
    const currentYear = new Date().getFullYear();
    const groups = buildYearGroups(currentYear, 0);

    expect(groups.map((group) => group.label)).toEqual(["今年及以前", "未来年份"]);
    expect(groups[0].options[0].value).toBe(String(currentYear));
    expect(groups[0].options.map((option) => option.value)).toContain("1900");
    expect(groups[0].options.map((option) => option.value)).not.toContain(String(currentYear + 1));
    expect(groups[1].options[0].value).toBe(String(currentYear + 1));
    expect(groups[1].options.map((option) => option.value)).toContain(String(currentYear + 15));
  });

  it("已选年份落在范围外时仍并入对应组，不会变成选不中的值", () => {
    const currentYear = new Date().getFullYear();
    const oldGroups = buildYearGroups(currentYear, 1850);
    expect(oldGroups[0].options.map((option) => option.value)).toContain("1850");
    expect(oldGroups[0].options[oldGroups[0].options.length - 1].value).toBe("1850");

    const futureGroups = buildYearGroups(currentYear, currentYear + 30);
    expect(futureGroups[1].options[futureGroups[1].options.length - 1].value).toBe(
      String(currentYear + 30),
    );
  });

  it("有值时挂载不触发 onChange，已选年份仍然显示", () => {
    const onChange = vi.fn();
    render(<PartialDateSelect label="教育日期" value="2024-06" onChange={onChange} />);

    // 空值/已有值都不得"自动写当前日期"——只有用户真的选了才回调。
    expect(onChange).not.toHaveBeenCalled();
    const shown = document.querySelectorAll<HTMLElement>(
      ".profile-partial-date-select .ant-select-content",
    );
    expect(shown[0]).toHaveTextContent("2024");
    expect(shown[1]).toHaveTextContent("06");
  });

  it("打开年份下拉时第一项就是本年，未来年份排在后面的分组里", () => {
    render(<PartialDateSelect label="工作日期" />);
    const currentYear = new Date().getFullYear();

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "工作日期年份" }));

    // 分组标题在 DOM 里（未来年份那一组在虚拟列表窗口之外，由上面的纯函数用例守）。
    expect(document.querySelector(".ant-select-item-group")).toHaveTextContent("今年及以前");
    const options = document.querySelectorAll(".ant-select-dropdown .ant-select-item-option");
    expect(options.length).toBeGreaterThan(0);
    expect(options[0]).toHaveAttribute("title", String(currentYear));
  });
});
