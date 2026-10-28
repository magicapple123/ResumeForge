// SPDX-License-Identifier: Apache-2.0
/**
 * W4「条目字段排版」面板：读/写 `format_config.field_layout` 的交互与归一化。
 *
 * 断言一律走 `t()` / role / aria-label（新增文件禁止中文 ByText，cjkRatchet 逐文件基线守着）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ResumeLayout } from "../../types";
import {
  FIELD_LAYOUT_FIELDS,
  defaultSectionLayout,
  isSectionDefault,
  moveField,
  normalizeSectionLayout,
  readFieldLayout,
  withSectionFieldLayout,
} from "../../features/resume-layout/fieldLayout";
import FieldLayoutPanel from "./FieldLayoutPanel";

const BASE_LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  format_config: {},
};

/** 落库形状（测试只看域内几个已知键，不引入 any）。 */
interface StoredSection {
  columns?: number;
  order?: string[];
  solo?: string[];
}

function layoutDomain(layout: ResumeLayout): Record<string, StoredSection> {
  const config = layout.format_config as Record<string, unknown> | undefined;
  const domain = config?.["field_layout"] as Record<string, StoredSection> | undefined;
  return domain ?? {};
}

function lastLayout(mock: { mock: { calls: unknown[][] } }): ResumeLayout {
  const calls = mock.mock.calls;
  return calls[calls.length - 1][0] as ResumeLayout;
}

function Harness({
  initial,
  onChange,
}: {
  initial: ResumeLayout;
  onChange?: (next: ResumeLayout) => void;
}) {
  const [layout, setLayout] = useState(initial);
  return (
    <AntdApp>
      <FieldLayoutPanel
        layout={layout}
        onChange={(next) => {
          setLayout(next);
          onChange?.(next);
        }}
      />
    </AntdApp>
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("FieldLayoutPanel · 默认态", () => {
  it("无配置时显示 1 列、默认字段顺序，恢复默认不可点", async () => {
    render(<Harness initial={BASE_LAYOUT} />);
    expect(
      await screen.findByRole("radio", { name: t("typography.fieldLayout.columns.1") }),
    ).toBeChecked();
    expect(screen.getByText(t("editor.field.studyForm"))).toBeInTheDocument();
    expect(screen.getByText(t("editor.field.researchDirection"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("typography.fieldLayout.reset") })).toBeDisabled();
  });

  it("切换列数即提交：写 columns，不写 order（默认顺序不落库）", async () => {
    const onChange = vi.fn();
    render(<Harness initial={BASE_LAYOUT} onChange={onChange} />);
    fireEvent.click(
      await screen.findByRole("radio", { name: t("typography.fieldLayout.columns.2") }),
    );
    const next = lastLayout(onChange);
    expect(layoutDomain(next).education.columns).toBe(2);
    expect(layoutDomain(next).education.order).toBeUndefined();
  });

  it("下移一格写全量 order（顺序变化必须显式落库）", async () => {
    const onChange = vi.fn();
    render(<Harness initial={BASE_LAYOUT} onChange={onChange} />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: t("typography.fieldLayout.moveDown", { label: t("editor.field.studyForm") }),
      }),
    );
    const next = lastLayout(onChange);
    expect(layoutDomain(next).education.order).toEqual([
      "degree_type",
      "study_form",
      "department",
      "rank",
      "advisor",
      "research_direction",
    ]);
  });

  it("独占一行开关写入 solo；关掉唯一一项后回到默认（整域不落库）", async () => {
    const onChange = vi.fn();
    render(<Harness initial={BASE_LAYOUT} onChange={onChange} />);
    const soloSwitch = await screen.findByRole("switch", {
      name: t("typography.fieldLayout.soloAria", { label: t("editor.field.advisor") }),
    });
    fireEvent.click(soloSwitch);
    expect(layoutDomain(lastLayout(onChange)).education.solo).toEqual(["advisor"]);

    fireEvent.click(soloSwitch);
    expect(layoutDomain(lastLayout(onChange))).toEqual({});
  });

  it("恢复默认只删当前分区，其它分区的设置保留", async () => {
    const configured: ResumeLayout = {
      ...BASE_LAYOUT,
      format_config: {
        field_layout: {
          version: 1,
          education: { columns: 2, order: ["rank"], solo: ["advisor"] },
          awards: { columns: 2 },
        },
      } as unknown as ResumeLayout["format_config"],
    };
    const onChange = vi.fn();
    render(<Harness initial={configured} onChange={onChange} />);
    fireEvent.click(await screen.findByRole("button", { name: t("typography.fieldLayout.reset") }));
    const next = lastLayout(onChange);
    expect(layoutDomain(next).education).toBeUndefined();
    expect(layoutDomain(next).awards.columns).toBe(2);
  });
});

describe("FieldLayoutPanel · 纯函数", () => {
  it("normalize：未知字段丢弃、未列出补末尾、solo 收敛为 order 子集", () => {
    const normalized = normalizeSectionLayout("education", {
      columns: 5,
      order: ["rank", "bogus", "rank", "study_form"],
      solo: ["advisor", "nope"],
    });
    expect(normalized.columns).toBe(3);
    expect(normalized.order).toHaveLength(FIELD_LAYOUT_FIELDS.education.length);
    expect(normalized.order.slice(0, 2)).toEqual(["rank", "study_form"]);
    expect(new Set(normalized.order).size).toBe(normalized.order.length);
    expect(normalized.solo).toEqual(["advisor"]);
  });

  it("read 只返回有自定义的分区；写回默认值时删掉该分区", () => {
    const layout: ResumeLayout = {
      ...BASE_LAYOUT,
      format_config: {
        field_layout: { version: 1, education: { columns: 2 } },
      } as unknown as ResumeLayout["format_config"],
    };
    const read = readFieldLayout(layout);
    expect(read.education?.columns).toBe(2);
    expect(read.awards).toBeUndefined();
    const reset = withSectionFieldLayout(layout, "education", defaultSectionLayout("education"));
    expect(layoutDomain(reset)).toEqual({});
    expect(isSectionDefault("education", defaultSectionLayout("education"))).toBe(true);
    expect(readFieldLayout({ ...BASE_LAYOUT, format_config: {} })).toEqual({});
  });

  it("moveField 越界返回原顺序，不产生空洞", () => {
    const order = ["a", "b", "c"];
    expect(moveField(order, 0, -1)).toEqual(order);
    expect(moveField(order, 2, 1)).toEqual(order);
    expect(moveField(order, 0, 1)).toEqual(["b", "a", "c"]);
  });
});
