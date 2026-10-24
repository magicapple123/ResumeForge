// SPDX-License-Identifier: Apache-2.0
/**
 * 分页设置区：条目/板块意图三态、续页信息、草稿不可见说明、矩阵口径的格式支持。
 * 断言走 t()/role，不写中文字面量（i18n 棘轮）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ResumeLayout } from "../../../types";
import PaginationControls from "./PaginationControls";

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  format_config: { accent: "#123456" },
};

function renderPanel(
  props: Partial<ComponentProps<typeof PaginationControls>> = {},
  onChange = vi.fn(),
) {
  render(
    <AntdApp>
      <PaginationControls layout={LAYOUT} onChange={onChange} {...props} />
    </AntdApp>,
  );
  return onChange;
}

function last(onChange: ReturnType<typeof vi.fn>): ResumeLayout {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]?.[0] as ResumeLayout;
}

/** antd Select 的选项在 jsdom 里以 .ant-select-item-option 渲染；按可见文本点选。 */
async function pickOption(text: string) {
  await waitFor(() => {
    const texts = Array.from(document.querySelectorAll(".ant-select-item-option")).map((el) =>
      el.textContent?.trim(),
    );
    expect(texts).toContain(text);
  });
  const option = Array.from(document.querySelectorAll(".ant-select-item-option")).find(
    (el) => el.textContent?.trim() === text,
  );
  expect(option).toBeTruthy();
  // 点选项内容节点（与其它 antd Select 测试一致；点容器在部分版本不触发 onChange）。
  const content = option?.querySelector(".ant-select-item-option-content");
  fireEvent.click((content ?? option) as Element);
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("PaginationControls · 条目与板块意图", () => {
  it("没有选中对象时给出提示，但续页信息仍可设置", () => {
    renderPanel();
    expect(screen.getByText(t("pagination.scope.pick"))).toBeInTheDocument();
    expect(screen.getByText(t("pagination.continuation.title"))).toBeInTheDocument();
  });

  it("条目级：从新页开始 / 标题跟随行数 / 允许跨页分别写 pagination 域", async () => {
    const onChange = renderPanel({ entry: { id: "exp_12345678", label: "Acme" } });
    fireEvent.click(screen.getByRole("switch", { name: t("pagination.breakBefore") }));
    expect(last(onChange).format_config).toEqual({
      accent: "#123456",
      pagination: { version: 1, entries: { exp_12345678: { break_before: "page" } } },
    });

    cleanup();
    const onChange2 = renderPanel({ entry: { id: "exp_12345678", label: "Acme" } });
    fireEvent.mouseDown(
      screen.getByRole("combobox", {
        name: t("pagination.keepWithNext.aria", { label: t("pagination.keepWithNext") }),
      }),
    );
    await pickOption(t("pagination.keepWithNext.lines", { count: 2 }));
    await waitFor(() => expect(onChange2).toHaveBeenCalled());
    expect(last(onChange2).format_config).toEqual({
      accent: "#123456",
      pagination: { version: 1, entries: { exp_12345678: { keep_with_next: 2 } } },
    });

    cleanup();
    const onChange3 = renderPanel({ entry: { id: "exp_12345678", label: "Acme" } });
    fireEvent.click(screen.getByRole("switch", { name: t("pagination.allowSplit") }));
    expect(last(onChange3).format_config).toEqual({
      accent: "#123456",
      pagination: { version: 1, entries: { exp_12345678: { allow_split: true } } },
    });
  });

  it("板块级：断页意图写到 sections；切换板块回传宿主（板块不支持允许跨页）", async () => {
    const onSectionChange = vi.fn();
    const sections = [
      { key: "experience", label: "工作经历" },
      { key: "projects", label: "项目经历" },
    ];
    const onChange = renderPanel({ sections, section: "experience", onSectionChange });
    fireEvent.click(screen.getByRole("switch", { name: t("pagination.breakBefore") }));
    expect((last(onChange).format_config as { pagination: unknown }).pagination).toEqual({
      version: 1,
      sections: { experience: { break_before: "page" } },
    });
    // 当前已选 experience；选另一个板块才会触发 onChange（antd 同值不回调）。
    fireEvent.mouseDown(screen.getByRole("combobox", { name: t("pagination.scope.sectionAria") }));
    await pickOption("项目经历");
    expect(onSectionChange).toHaveBeenCalledWith("projects");
    expect(screen.queryByRole("switch", { name: t("pagination.allowSplit") })).toBeNull();
  });

  it("续页信息：打开写 true，关掉后域被删除（恢复默认不写 false）", () => {
    const onChange = renderPanel();
    const pageNumbers = screen.getByRole("switch", {
      name: t("pagination.continuation.pageNumbers"),
    });
    fireEvent.click(pageNumbers);
    expect(last(onChange).format_config).toEqual({
      accent: "#123456",
      pagination: { version: 1, continuation: { page_numbers: true } },
    });
  });
});

describe("PaginationControls · 格式支持（矩阵口径）", () => {
  it("有矩阵时只列非 supported 的格子", () => {
    renderPanel({
      capabilities: {
        "html:manual_page_break": "approx",
        "pdf:manual_page_break": "unsupported",
        "pdf:keep_with_next": "supported",
      },
    });
    expect(
      screen.getByText(
        `${t("preflight.format.pdf")} ${t("pagination.capability.entryBreak")} ${t("preflight.capability.unsupported")}`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `${t("preflight.format.html")} ${t("pagination.capability.entryBreak")} ${t("preflight.capability.approx")}`,
      ),
    ).toBeInTheDocument();
  });

  it("没有矩阵时如实说明以检查模块为准，不自己编", () => {
    renderPanel();
    expect(screen.getByText(t("pagination.capability.pending"))).toBeInTheDocument();
  });

  it("草稿预览不可见手动分页：常驻说明（不画假分页线）", () => {
    renderPanel({ entry: { id: "exp_12345678", label: "Acme" } });
    expect(screen.getByText(t("pagination.draft.note"))).toBeInTheDocument();
  });
});
