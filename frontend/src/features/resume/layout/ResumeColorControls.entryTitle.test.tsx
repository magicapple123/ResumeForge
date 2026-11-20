// SPDX-License-Identifier: Apache-2.0
/**
 * 参数 · **外观**组第 5 格「条目标题」：写的是 `format_config.roles.entry_title.color`
 * （角色级覆盖），不是新键。
 *
 * 从 `ResumeColorControls.test.tsx` 拆出（T08 加完这一组后越过 500 行预算）。**纯搬迁**：
 * 用例数量、标题与断言逐字不变；夹具在 `ResumeColorControls.testkit.tsx`。
 *
 * 这一格最容易接错的地方：
 * 1. **未设时必须显示正文色**（模板里条目标题继承 `body`），不能编一个假值；
 * 2. 探针必须与后端 `_role_rules` 逐字一致（`  [data-role="entry_title"] { color: …; }`，
 *    **没有 `!important`**——加了会在拖动时盖过单条覆盖、松手后又让回去）；
 * 3. 删键走 `withRoleProp`：清掉最后一个属性时整个 role 键要消失，不留空对象；
 * 4. 删色不能连坐同一角色下的字号 / 粗细（那是「角色样式」面板的数据）。
 *
 * 断言文案一律走 `t()`；中文只出现在注释里（`cjkRatchet` 口径）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { t } from "../../../i18n";
import { TEMPLATE_CATALOG } from "../../../test/resumeFixtures";
import type { ResumeFormatConfig, ResumeLayout, ResumeTemplateCatalog } from "../../../types";
import { DEFAULT_LAYOUT, makePreviewRef } from "./ResumeLayoutControls.testkit";
import ResumeColorControls from "./ResumeColorControls";

/** 强调色的标签由目录下发（`format_fields[].label` 只有一份来源）。 */
export const ACCENT_LABEL =
  TEMPLATE_CATALOG.format_fields?.find((field) => field.key === "accent")?.label ?? "accent";

export const BASE: ResumeLayout = { ...DEFAULT_LAYOUT, format_config: {} };

/** classic 的四色（与后端 `resume_template_palette` 同值）；夹具默认不下发 palette。 */
export const CLASSIC_PALETTE = {
  accent: "#16365c",
  text_color: "#1f2937",
  muted_color: "#6b7280",
  line_color: "#d9dee7",
};

/** 给 classic 下发 palette 的目录副本（模拟新后端）。 */
export function catalogWithPalette(): ResumeTemplateCatalog {
  return {
    ...TEMPLATE_CATALOG,
    templates: TEMPLATE_CATALOG.templates.map((item) =>
      item.name === "classic" ? { ...item, palette: { ...CLASSIC_PALETTE } } : item,
    ),
  };
}

/**
 * `format_config` 的 TS 声明是扁平联合（`Record<string, number | string | string[]>`），
 * 而 `roles` 在真实数据里是嵌套对象（后端 `format_config.roles.<role>.<prop>`）。
 * 测试要构造真实结构，只能在这一处做类型桥——不要因此把断言放宽成 `any`。
 */
export function withRoles(config: Record<string, unknown>): ResumeFormatConfig {
  return config as unknown as ResumeFormatConfig;
}

export function renderGroup(
  props: Partial<ComponentProps<typeof ResumeColorControls>> = {},
  onChange = vi.fn(),
) {
  render(
    <AntdApp>
      <ResumeColorControls
        layout={BASE}
        catalog={TEMPLATE_CATALOG}
        onChange={onChange}
        {...props}
      />
    </AntdApp>,
  );
  return onChange;
}

export function cards(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".resume-wb-color-card"));
}

/** 卡片主按钮（唯一合法的点击区）。 */
export function cardMain(index: number): HTMLElement {
  const button = cards()[index].querySelector<HTMLElement>(".resume-wb-color-main");
  if (!button) throw new Error(`第 ${index} 张色卡没有主按钮`);
  return button;
}

/** 打开某张卡（取色器只有一个实例，随 `pickerKey` 移动）。 */
export function openCard(index: number) {
  fireEvent.click(cardMain(index));
}

/** antd 预设色块（`ColorPresets` 渲染的是 div，不是 button）；顺序即 `PALETTE`。 */
export function presetSwatches(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".ant-color-picker-presets-color"));
}

export function lastLayout(onChange: ReturnType<typeof vi.fn>): ResumeLayout {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]?.[0] as ResumeLayout;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumeColorControls · 第 5 格条目标题", () => {
  const ENTRY_TITLE_LABEL = t("typography.role.entry_title");

  function entryTitleCard(): HTMLElement {
    return cards()[4];
  }

  it("未设过：显示「随正文」+ 真正继承到的正文色", () => {
    renderGroup({ catalog: catalogWithPalette() });

    expect(entryTitleCard().querySelector(".resume-wb-color-name")?.textContent).toBe(
      ENTRY_TITLE_LABEL,
    );
    expect(entryTitleCard().querySelector(".resume-wb-color-value")?.textContent).toBe(
      `${CLASSIC_PALETTE.text_color} · ${t("workbench.color.followBody")}`,
    );
    // 没有自己的覆盖 → 没有 ↺（双击名称也不产生变更，见上一个 describe）。
    expect(entryTitleCard().querySelector(".resume-wb-color-reset")).toBeNull();
  });

  it("改「正文」色时这一格跟着走（它继承的是正文色，不是独立默认值）", () => {
    renderGroup({
      catalog: catalogWithPalette(),
      layout: { ...BASE, format_config: { text_color: "#7f1d1d" } },
    });

    expect(entryTitleCard().querySelector(".resume-wb-color-value")?.textContent).toBe(
      `#7f1d1d · ${t("workbench.color.followBody")}`,
    );
    const chip = entryTitleCard().querySelector<HTMLElement>(".resume-wb-color-chip");
    expect(chip?.style.getPropertyValue("--resume-wb-chip")).toBe("#7f1d1d");
  });

  it("点预设：探针逐字等于后端 _role_rules，落库写 roles.entry_title.color", () => {
    const { ref, setLiveProbe } = makePreviewRef();
    const onChange = renderGroup({ catalog: catalogWithPalette(), previewRef: ref });

    openCard(4);
    fireEvent.click(presetSwatches()[2]);

    // 后端 resume_style._rule → `  [data-role="entry_title"] { color: #1e3a8a; }`
    // （两空格缩进、无 `!important`）：单条覆盖比它更具体，仍然以单条为准。
    expect(setLiveProbe).toHaveBeenCalledWith('  [data-role="entry_title"] { color: #1e3a8a; }');
    expect(lastLayout(onChange).format_config).toEqual({
      roles: { entry_title: { color: "#1e3a8a" }, version: 1 },
    });
  });

  it("双击名称删色：空 role 一并摘掉（不留 `roles.entry_title: {}`）", () => {
    const onChange = renderGroup({
      layout: {
        ...BASE,
        format_config: withRoles({
          line_height: 1.6,
          roles: { entry_title: { color: "#7f1d1d" } },
        }),
      },
    });

    fireEvent.doubleClick(
      screen.getByText(ENTRY_TITLE_LABEL, { selector: ".resume-wb-color-name" }),
    );

    // `withRoleProp(…, null)` 删的是"这一个属性"；role 空了就连键一起消失。
    expect(lastLayout(onChange).format_config).toEqual({ line_height: 1.6 });
  });

  it("删色不连坐同一角色下的字号（不是 clearRole，是删这一个属性）", () => {
    const onChange = renderGroup({
      layout: {
        ...BASE,
        format_config: withRoles({
          roles: { entry_title: { color: "#7f1d1d", font_scale: 1.25 } },
        }),
      },
    });

    fireEvent.doubleClick(
      screen.getByText(ENTRY_TITLE_LABEL, { selector: ".resume-wb-color-name" }),
    );

    expect(lastLayout(onChange).format_config).toEqual({
      roles: { entry_title: { font_scale: 1.25 }, version: 1 },
    });
  });

  it("基线里有角色色、当前没有：↺ 把角色键搬回来", () => {
    const onChange = renderGroup({
      layout: { ...BASE, format_config: {} },
      baseline: {
        ...BASE,
        format_config: withRoles({ roles: { entry_title: { color: "#111111" } } }),
      },
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: t("workbench.param.restoreToOpenedAria", { label: ENTRY_TITLE_LABEL }),
      }),
    );

    expect(lastLayout(onChange).format_config).toEqual({
      roles: { entry_title: { color: "#111111" }, version: 1 },
    });
  });
});
