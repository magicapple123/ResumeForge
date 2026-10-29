// SPDX-License-Identifier: Apache-2.0
/**
 * W4「条目字段排版」面板：读/写 `format_config.field_layout` 的交互与归一化。
 *
 * 断言一律走 `t()` / role / aria-label（新增文件禁止中文 ByText，cjkRatchet 逐文件基线守着）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ResumeLayout } from "../../types";
import {
  FIELD_LAYOUT_FIELDS,
  GAP_MAX,
  GAP_MIN,
  defaultSectionLayout,
  isSectionDefault,
  moveField,
  normalizeGap,
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
  align?: "equal" | "flow";
  gap?: number;
  order?: string[];
  solo?: string[];
}

/** rc-slider 读的是 `keyCode`/`which`（不是 `key`），方向键是最稳的"拖动"替代。 */
function pressArrow(target: Element, direction: "ArrowLeft" | "ArrowRight") {
  const keyCode = direction === "ArrowRight" ? 39 : 37;
  fireEvent.keyDown(target, { key: direction, keyCode, which: keyCode });
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
    // 对齐方式 / 列间距都是默认值 → 这两个键不落库（后端解析时补默认）。
    expect(layoutDomain(next).education.align).toBeUndefined();
    expect(layoutDomain(next).education.gap).toBeUndefined();
  });

  it("切换对齐方式即提交：写 align，gap 不落库", async () => {
    const onChange = vi.fn();
    render(<Harness initial={BASE_LAYOUT} onChange={onChange} />);
    fireEvent.click(
      await screen.findByRole("radio", { name: t("typography.fieldLayout.align.flow") }),
    );
    const next = lastLayout(onChange);
    expect(layoutDomain(next).education.align).toBe("flow");
    expect(layoutDomain(next).education.gap).toBeUndefined();
  });

  it("列间距是滑杆：默认显示当前对齐模式的兜底值，切到按内容后跟着变", async () => {
    render(<Harness initial={BASE_LAYOUT} />);
    const slider = await screen.findByRole("slider", {
      name: t("typography.fieldLayout.gapLabel"),
    });
    // 等宽对齐兜底 1.6 倍字号。
    expect(slider).toHaveAttribute("aria-valuenow", "1.6");
    expect(
      screen.getByText(t("typography.fieldLayout.gapValue", { value: "1.6" })),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: t("typography.fieldLayout.align.flow") }));
    // 按内容顺排兜底 1.2 倍字号（保持改造前的观感）。
    expect(
      screen.getByRole("slider", { name: t("typography.fieldLayout.gapLabel") }),
    ).toHaveAttribute("aria-valuenow", "1.2");
    expect(
      screen.getByText(t("typography.fieldLayout.gapValue", { value: "1.2" })),
    ).toBeInTheDocument();
  });

  it("拖动滑杆写入数值 gap（1 位小数），align 不落库", async () => {
    const onChange = vi.fn();
    render(<Harness initial={BASE_LAYOUT} onChange={onChange} />);
    const slider = await screen.findByRole("slider", {
      name: t("typography.fieldLayout.gapLabel"),
    });
    pressArrow(slider, "ArrowRight"); // 1.6 → 1.8（步长 0.2；拖动期只更新本地读数）
    expect(onChange).not.toHaveBeenCalled();
    // 停顿 120ms 才提交（防抖），所以这里等它到。
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = lastLayout(onChange);
    expect(layoutDomain(next).education.gap).toBe(1.8);
    expect(layoutDomain(next).education.align).toBeUndefined();
  });

  it("连续步进多次只提交一次，且值是最终值", async () => {
    const onChange = vi.fn();
    render(<Harness initial={BASE_LAYOUT} onChange={onChange} />);
    const slider = await screen.findByRole("slider", {
      name: t("typography.fieldLayout.gapLabel"),
    });
    pressArrow(slider, "ArrowRight"); // 1.6 → 1.8
    pressArrow(slider, "ArrowRight"); // → 2.0
    pressArrow(slider, "ArrowRight"); // → 2.2
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    // 再多等一段（> 防抖窗口），确认没有补发的第二次提交。
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(layoutDomain(lastLayout(onChange)).education.gap).toBe(2.2);
  });

  it("拖动未落库就改列数：防抖提交读最新配置，不把列数覆盖回旧值", async () => {
    const onChange = vi.fn();
    render(<Harness initial={BASE_LAYOUT} onChange={onChange} />);
    const slider = await screen.findByRole("slider", {
      name: t("typography.fieldLayout.gapLabel"),
    });
    // 1.6 → 1.8 → 2.0，只更新本地读数：防抖窗口（120ms）内还没提交。
    pressArrow(slider, "ArrowRight");
    pressArrow(slider, "ArrowRight");
    expect(onChange).not.toHaveBeenCalled();
    // 窗口内立刻改列数：这一次先落库（columns: 3）。
    fireEvent.click(screen.getByRole("radio", { name: t("typography.fieldLayout.columns.3") }));
    expect(layoutDomain(lastLayout(onChange)).education.columns).toBe(3);
    // 防抖到点后必须基于**最新**配置合并提交：列数仍是 3，间距补上 2.0，互不覆盖。
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    const next = layoutDomain(lastLayout(onChange)).education;
    expect(next.columns).toBe(3);
    expect(next.gap).toBe(2.0);
  });

  it("间距拖回兜底值后整域不落库", async () => {
    const configured: ResumeLayout = {
      ...BASE_LAYOUT,
      format_config: {
        field_layout: { version: 1, education: { gap: 2.4 } },
      } as unknown as ResumeLayout["format_config"],
    };
    const onChange = vi.fn();
    render(<Harness initial={configured} onChange={onChange} />);
    const slider = await screen.findByRole("slider", {
      name: t("typography.fieldLayout.gapLabel"),
    });
    expect(slider).toHaveAttribute("aria-valuenow", "2.4");
    // 2.4 → 1.6 是 4 步（步长 0.2）——回到兜底值 = 与"未设置"等价 → 整域不落库。
    for (let step = 0; step < 4; step += 1) pressArrow(slider, "ArrowLeft");
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(layoutDomain(lastLayout(onChange))).toEqual({});
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

describe("FieldLayoutPanel · 列间距加减按钮", () => {
  /** 两个方形按钮只有图标，靠 aria-label 定位（文案在语言包里）。 */
  function gapButton(kind: "decrease" | "increase"): HTMLElement {
    return screen.getByRole("button", {
      name: t(
        kind === "decrease"
          ? "typography.fieldLayout.gapDecrease"
          : "typography.fieldLayout.gapIncrease",
      ),
    });
  }

  it("点一次加号：gap 比原值大一个步长（1 位小数），滑杆与读数同步", async () => {
    const onChange = vi.fn();
    render(<Harness initial={BASE_LAYOUT} onChange={onChange} />);
    await screen.findByRole("slider", { name: t("typography.fieldLayout.gapLabel") });
    // 等宽对齐兜底 1.6 → 点一次 1.8（GAP_STEP = 0.2）。
    fireEvent.click(gapButton("increase"));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(layoutDomain(lastLayout(onChange)).education.gap).toBe(1.8);
    // 刻度（marks）已移除，定位靠"滑杆 + 读数"这一对：两个都得在，且都跟着走。
    expect(
      screen.getByRole("slider", { name: t("typography.fieldLayout.gapLabel") }),
    ).toHaveAttribute("aria-valuenow", "1.8");
    expect(
      screen.getByText(t("typography.fieldLayout.gapValue", { value: "1.8" })),
    ).toBeInTheDocument();
  });

  it("点一次减号：gap 比原值小一个步长（1 位小数）", async () => {
    const onChange = vi.fn();
    render(<Harness initial={BASE_LAYOUT} onChange={onChange} />);
    await screen.findByRole("slider", { name: t("typography.fieldLayout.gapLabel") });
    // 1.6 → 1.4（浮点累加要按 1 位小数取整，否则会写出 1.4000000000000001）。
    fireEvent.click(gapButton("decrease"));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(layoutDomain(lastLayout(onChange)).education.gap).toBe(1.4);
  });

  it("到下限时减号禁用、到上限时加号禁用", async () => {
    const atMin: ResumeLayout = {
      ...BASE_LAYOUT,
      format_config: {
        field_layout: { version: 1, education: { gap: GAP_MIN } },
      } as unknown as ResumeLayout["format_config"],
    };
    const { unmount } = render(<Harness initial={atMin} />);
    await screen.findByRole("slider", { name: t("typography.fieldLayout.gapLabel") });
    expect(gapButton("decrease")).toBeDisabled();
    expect(gapButton("increase")).toBeEnabled();
    unmount();

    const atMax: ResumeLayout = {
      ...BASE_LAYOUT,
      format_config: {
        field_layout: { version: 1, education: { gap: GAP_MAX } },
      } as unknown as ResumeLayout["format_config"],
    };
    render(<Harness initial={atMax} />);
    await screen.findByRole("slider", { name: t("typography.fieldLayout.gapLabel") });
    expect(gapButton("increase")).toBeDisabled();
    expect(gapButton("decrease")).toBeEnabled();
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

  it("normalize：align 未知值落回 equal；gap 归一成倍数或 null", () => {
    const broken = normalizeSectionLayout("education", {
      columns: 2,
      align: "diagonal",
      gap: "huge",
    });
    expect(broken.align).toBe("equal");
    expect(broken.gap).toBeNull();
    const kept = normalizeSectionLayout("education", { columns: 2, align: "flow", gap: 2.4 });
    expect(kept.align).toBe("flow");
    expect(kept.gap).toBe(2.4);
    // 缺省（旧配置）同样拿到 equal / 未设置间距。
    const legacy = normalizeSectionLayout("education", { columns: 2 });
    expect(legacy.align).toBe("equal");
    expect(legacy.gap).toBeNull();
    expect(defaultSectionLayout("education").align).toBe("equal");
    expect(defaultSectionLayout("education").gap).toBeNull();
    // 旧枚举：narrow / wide 迁移成倍数，normal = 未设置。
    expect(normalizeSectionLayout("education", { gap: "narrow" }).gap).toBe(0.8);
    expect(normalizeSectionLayout("education", { gap: "wide" }).gap).toBe(3);
    expect(normalizeSectionLayout("education", { gap: "normal" }).gap).toBeNull();
  });

  it("normalizeGap：夹取到 0–30 并保留 1 位小数，坏值为 null", () => {
    expect(normalizeGap(2.44)).toBe(2.4);
    expect(normalizeGap(99)).toBe(30);
    expect(normalizeGap(-1)).toBe(0);
    // `0` 是合法值（两列完全紧挨），必须原样返回，不能当"未设置"。
    expect(normalizeGap(0)).toBe(0);
    expect(normalizeGap(Number.NaN)).toBeNull();
    expect(normalizeGap(true)).toBeNull();
    expect(normalizeGap(null)).toBeNull();
    expect(normalizeGap("x")).toBeNull();
    expect(normalizeGap("wide")).toBe(3);
  });

  it("gap = 0 落库并读回 0（不被当成未设置退回兜底 1.6）", () => {
    const zero = withSectionFieldLayout(BASE_LAYOUT, "education", {
      ...defaultSectionLayout("education"),
      columns: 2,
      gap: 0,
    });
    expect(layoutDomain(zero).education.gap).toBe(0);
    expect(readFieldLayout(zero).education?.gap).toBe(0);
    // 0 与兜底值（1.6）不等 → 不是"全默认"，必须留下。
    expect(isSectionDefault("education", { ...defaultSectionLayout("education"), gap: 0 })).toBe(
      false,
    );
  });

  it("gap 与当前 align 的兜底值相同就不落库；不同才落库", () => {
    const base = defaultSectionLayout("education");
    expect(isSectionDefault("education", { ...base, gap: 1.6 })).toBe(true);
    // flow + 兜底 1.2：align 本身是自定义（要落库），但 gap 不该落库。
    const flowDefault = withSectionFieldLayout(BASE_LAYOUT, "education", {
      ...base,
      align: "flow",
      gap: 1.2,
    });
    expect(layoutDomain(flowDefault).education.align).toBe("flow");
    expect(layoutDomain(flowDefault).education.gap).toBeUndefined();
    // 1.6 对 flow 不是兜底值（1.2 才是）→ 必须落库。
    const flowCustom = withSectionFieldLayout(BASE_LAYOUT, "education", {
      ...base,
      align: "flow",
      gap: 1.6,
    });
    expect(layoutDomain(flowCustom).education.gap).toBe(1.6);
  });

  it("只有 align 偏离默认也算有自定义（必须落库）", () => {
    const next = withSectionFieldLayout(BASE_LAYOUT, "education", {
      ...defaultSectionLayout("education"),
      align: "flow",
    });
    expect(layoutDomain(next).education.align).toBe("flow");
    expect(layoutDomain(next).education.gap).toBeUndefined();
    expect(readFieldLayout(next).education?.align).toBe("flow");
  });
});
