import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PartialDateSelect, { normalizePartialDate } from "./PartialDateSelect";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

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
});
