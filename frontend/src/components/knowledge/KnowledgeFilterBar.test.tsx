// SPDX-License-Identifier: Apache-2.0
/** 知识库筛选条（#29A/#29D/#29G）：筛选回传、语义模式禁用冲突项、导出入口。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { KnowledgeFilters } from "./useKnowledgeFilters";
import KnowledgeFilterBar from "./KnowledgeFilterBar";

/** 公司名是数据不是界面文案：用常量传给 ByText 参数，避免测试断言里出现未登记中文。 */
const COMPANY = "字节跳动";

const FILTERS: KnowledgeFilters = {
  keyword: "",
  category: "",
  tag: "",
  company: "",
  uncategorized: false,
  page: 1,
};

function renderBar(
  overrides: {
    filters?: Partial<KnowledgeFilters>;
    semantic?: boolean;
    onChange?: (patch: Partial<KnowledgeFilters>) => void;
    onExport?: () => void;
  } = {},
) {
  const onChange = overrides.onChange ?? vi.fn();
  const onExport = overrides.onExport ?? vi.fn();
  render(
    <AntdApp>
      <KnowledgeFilterBar
        filters={{ ...FILTERS, ...overrides.filters }}
        onChange={onChange}
        semantic={overrides.semantic ?? false}
        onSemanticChange={vi.fn()}
        categories={["面经", "简历技巧"]}
        tags={["字节", "STAR"]}
        companies={["字节跳动", "示例科技"]}
        exporting={false}
        onExport={onExport}
      />
    </AntdApp>,
  );
  return { onChange, onExport };
}

afterEach(cleanup);

describe("KnowledgeFilterBar", () => {
  it("搜索回车把关键词交给页面（URL 状态由 page 写）", () => {
    const { onChange } = renderBar();
    const input = screen.getByPlaceholderText(t("knowledgePage.filter.search.placeholder"));
    fireEvent.change(input, { target: { value: "  限流  " } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13 });
    expect(onChange).toHaveBeenCalledWith({ keyword: "限流" });
  });

  it("公司筛选回传精确公司名（#29D）", async () => {
    const { onChange } = renderBar();
    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: t("knowledgePage.filter.company.aria") }),
    );
    fireEvent.click(
      await screen.findByText(
        (content, element) => content === COMPANY && !!element?.closest(".ant-select-item-option"),
      ),
    );
    expect(onChange).toHaveBeenCalledWith({ company: COMPANY });
  });

  it("只看未分类开关回传布尔值（#29G）", () => {
    const { onChange } = renderBar();
    fireEvent.click(
      screen.getByRole("checkbox", { name: t("knowledgePage.filter.uncategorized") }),
    );
    expect(onChange).toHaveBeenCalledWith({ uncategorized: true });
  });

  it("语义检索打开：分类/标签/未分类/导出禁用（后端 /search 只认 q 与 company）", () => {
    renderBar({ semantic: true });
    expect(
      screen.getByRole("combobox", { name: t("knowledgePage.filter.category.aria") }),
    ).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: t("knowledgePage.filter.tag.aria") }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: t("knowledgePage.filter.uncategorized") }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: new RegExp(t("knowledgePage.action.export")) }),
    ).toBeDisabled();
    // 公司筛选两边都支持：语义模式下仍可用。
    expect(
      screen.getByRole("combobox", { name: t("knowledgePage.filter.company.aria") }),
    ).toBeEnabled();
  });

  it("导出按钮触发导出回调（#29 导出）", () => {
    const { onExport } = renderBar();
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("knowledgePage.action.export")) }),
    );
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
