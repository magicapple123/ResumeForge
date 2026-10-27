// SPDX-License-Identifier: Apache-2.0
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Form } from "antd";
import { useState, type ReactNode } from "react";
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

  it("勾上「至今」再取消：回到勾选前的日期，而不是被清空", () => {
    // 回归（QA B1）：勾选写「至今」、取消写空串，于是 2004-11-10 勾一下再取消就没了。
    // 「至今」只是这个值的一种写法，不是"删除"。
    const seen: string[] = [];
    function Harness() {
      const [value, setValue] = useState("2004-11-10");
      return (
        <PartialDateSelect
          label="教育日期"
          value={value}
          onChange={(next) => {
            seen.push(next);
            setValue(next);
          }}
          allowOngoing
        />
      );
    }
    render(<Harness />);

    const box = screen.getByRole("checkbox", { name: "至今" });
    fireEvent.click(box);
    expect(seen).toEqual(["至今"]);
    // 勾选期间三个下拉被锁住（值已被「至今」取代）。
    expect(screen.getByRole("combobox", { name: "教育日期年份" })).toBeDisabled();

    fireEvent.click(box);
    expect(seen).toEqual(["至今", "2004-11-10"]);
    // 渲染层也回到原值：年 / 月 / 日三格各自显示原来的数字。
    const shown = document.querySelectorAll<HTMLElement>(
      ".profile-partial-date-select .ant-select-content",
    );
    expect(shown[0]).toHaveTextContent("2004");
    expect(shown[1]).toHaveTextContent("11");
    expect(shown[2]).toHaveTextContent("10");
  });

  it("从来没有具体日期时，取消「至今」保持空值", () => {
    // 没有可恢复的历史值就不该凭空编一个：取消勾选 = 回到勾选前的空。
    const seen: string[] = [];
    function Harness() {
      const [value, setValue] = useState("");
      return (
        <PartialDateSelect
          label="教育日期"
          value={value}
          onChange={(next) => {
            seen.push(next);
            setValue(next);
          }}
          allowOngoing
        />
      );
    }
    render(<Harness />);

    const box = screen.getByRole("checkbox", { name: "至今" });
    fireEvent.click(box);
    fireEvent.click(box);
    expect(seen).toEqual(["至今", ""]);
  });
});

describe("PartialDateSelect 年份分组（R9）", () => {
  /**
   * 分组是纯函数（当前年由调用方传入），所以这一组用例固定一个年份，
   * 不跟着运行机器的真实日期漂：跨年那天跑 CI 不会红。
   */
  const FIXED_YEAR = 2026;

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("两组：第一组第一项是当前年，未来年份退到第二组，最多到 +5", () => {
    // 回归：原来下拉是从「当前年+15」开始降序的，选出生年份要先滚过十几个未来年份。
    const groups = buildYearGroups(FIXED_YEAR, 0);

    expect(groups.map((group) => group.label)).toEqual(["今年及以前", "未来年份"]);
    expect(groups[0].options[0].value).toBe(String(FIXED_YEAR));
    expect(groups[0].options.map((option) => option.value)).toContain("1900");
    expect(groups[0].options.map((option) => option.value)).not.toContain(String(FIXED_YEAR + 1));
    expect(groups[1].options[0].value).toBe(String(FIXED_YEAR + 1));
    // 未来只留 5 年：+5 在，+6 不在（原来放到 +15，未来组一半是永远用不到的空档）。
    expect(groups[1].options.map((option) => option.value)).toContain(String(FIXED_YEAR + 5));
    expect(groups[1].options.map((option) => option.value)).not.toContain(String(FIXED_YEAR + 6));
    expect(groups[1].options[groups[1].options.length - 1].value).toBe(String(FIXED_YEAR + 5));
  });

  it("已选年份落在范围外时仍并入对应组，不会变成选不中的值", () => {
    const oldGroups = buildYearGroups(FIXED_YEAR, 1850);
    expect(oldGroups[0].options.map((option) => option.value)).toContain("1850");
    expect(oldGroups[0].options[oldGroups[0].options.length - 1].value).toBe("1850");

    // 脏数据（未来 30 年）把未来组外扩到它，且排在组末尾。
    const futureGroups = buildYearGroups(FIXED_YEAR, FIXED_YEAR + 30);
    expect(futureGroups[1].options[futureGroups[1].options.length - 1].value).toBe(
      String(FIXED_YEAR + 30),
    );
    expect(futureGroups[1].options.map((option) => option.value)).toContain(String(FIXED_YEAR + 5));
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

    // 第一组的第一项必须是今年：否则选出生年份要先滚过一屏未来年份。
    expect(document.querySelector(".ant-select-item-group")).toHaveTextContent("今年及以前");
    const options = document.querySelectorAll(".ant-select-dropdown .ant-select-item-option");
    expect(options.length).toBeGreaterThan(0);
    expect(options[0]).toHaveAttribute("title", String(currentYear));
  });

  it("已选的远期年份仍显示得出来（外扩保证它不是「选不中的值」）", () => {
    // 未来组只到 +5，但存储里已有的 +30 不能被悄悄抹掉：外扩逻辑把它并进组里。
    const currentYear = new Date().getFullYear();
    render(<PartialDateSelect label="毕业日期" value={String(currentYear + 30)} />);

    const shown = document.querySelector<HTMLElement>(
      ".profile-partial-date-select .ant-select-content",
    );
    expect(shown).toHaveTextContent(String(currentYear + 30));
  });

  it("年份弹层的可视高度放宽到 320px，且未来组到 +5 为止", () => {
    render(<PartialDateSelect label="毕业日期" />);
    const currentYear = new Date().getFullYear();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "毕业日期年份" }));

    const holder = document.querySelector<HTMLElement>(
      ".ant-select-dropdown .ant-select-dropdown-list-holder",
    );
    expect(holder).not.toBeNull();
    expect(holder!.style.maxHeight).toBe("320px");

    // 下拉里确实只有 +1 ~ +5：读的是真实渲染出来的选项，不只是纯函数的返回值。
    const years = Array.from(
      document.querySelectorAll<HTMLElement>(".ant-select-dropdown .ant-select-item-option"),
    )
      .map((node) => Number(node.getAttribute("title")))
      .filter((year) => Number.isFinite(year));
    expect(Math.max(...years)).toBe(currentYear + 5);
    expect(years).not.toContain(currentYear + 6);
    expect(
      Array.from(document.querySelectorAll(".ant-select-item-group")).map(
        (node) => node.textContent,
      ),
    ).toEqual(["今年及以前", "未来年份"]);
  });
});

describe("PartialDateSelect 年份宽度（P1）", () => {
  it("年份控件保留最小宽度，弹出层带独立类名（宽度不跟随控件）", () => {
    // 回归：年/月/日挤在 Space.Compact 里等分，控件只有几十像素宽，弹层若跟随控件
    // 宽度就会把「2024」截成「20」。`popupMatchSelectWidth={false}` 让弹层按内容自适应，
    // 但它的效果只能在有真实布局的浏览器里量（jsdom 里所有尺寸都是 0），所以这里断言
    // 两处**可观测**的替代信号：控件自己的 minWidth，以及弹层的类名（由新增的
    // styles/partialDate.css 提供 min-width 兜底）。
    render(<PartialDateSelect label="教育日期" />);

    const yearSelect = document.querySelector<HTMLElement>(
      ".profile-partial-date-select .ant-select",
    );
    expect(yearSelect).not.toBeNull();
    expect(yearSelect!.style.minWidth).toBe("80px");

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "教育日期年份" }));
    const dropdown = document.querySelector(".ant-select-dropdown");
    expect(dropdown).not.toBeNull();
    expect(dropdown).toHaveClass("profile-year-select-popup");
  });
});
