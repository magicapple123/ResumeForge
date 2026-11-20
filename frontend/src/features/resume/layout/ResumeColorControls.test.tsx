// SPDX-License-Identifier: Apache-2.0
/**
 * 参数 · **外观**组：2×2 色卡（I-09）与四个颜色键的写入语义（P1-1）。
 *
 * 这一组最容易接错的地方都不在"看上去对不对"：
 *
 * 1. 一次取色**只写自己那个键**（写成整份 `format_config` 覆盖 = 把别人调好的行距一起抹掉）；
 * 2. 恢复默认 = **删键**（写回"模板默认色"会让以后模板换配色时这些简历不跟着变）；
 * 3. 探针与后端 `format_css` 的 `:root` 声明**逐字一致**（`:root { --accent: #1e3a8a; }`），
 *    否则松手后颜色会跳一下；
 * 4. 色块显示的是**生效色**：`自己的覆盖 > 版式预设 > 模板配色（后端下发） > 占位`，
 *    第四级必须是斜纹 + 「随模板」，不能编一个假色值（I-09 的验收口径）。
 *
 * 断言文案一律走 `t()` 或取目录里的 `label`；中文只出现在注释里（`cjkRatchet` 口径）。
 *
 * 2026-11-19 行数预算拆分批：T08 第 5 格「条目标题」的用例移到
 * `ResumeColorControls.entryTitle.test.tsx`，共用夹具在 `ResumeColorControls.testkit.tsx`。
 * 本文件只留前四格的写入语义、四级生效色与样式原文。**纯搬迁**，断言逐字不变。
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../../../test/resumeFixtures";
import { t } from "../../../i18n";
import type { ResumeLayout, ResumeTemplateCatalog } from "../../../types";
import { makePreviewRef } from "./ResumeLayoutControls.testkit";
import {
  ACCENT_LABEL,
  BASE,
  CLASSIC_PALETTE,
  cards,
  cardMain,
  catalogWithPalette,
  lastLayout,
  openCard,
  presetSwatches,
  renderGroup,
} from "./ResumeColorControls.entryTitle.test";

declare const process: { cwd(): string };

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ResumeColorControls · 写入语义", () => {
  it("点预设：只写 accent，其它覆盖原样保留，并先注入逐字一致的探针", () => {
    const { ref, setLiveProbe } = makePreviewRef();
    const onChange = renderGroup({
      layout: { ...BASE, format_config: { line_height: 1.6 } },
      previewRef: ref,
    });

    openCard(0);
    const navy = presetSwatches()[2];
    expect(navy).toBeDefined();
    fireEvent.click(navy);

    // 探针 = 后端 `format_css` 的 `:root` 声明（同一串字符）。
    expect(setLiveProbe).toHaveBeenCalledWith(":root { --accent: #1e3a8a; }");
    const next = lastLayout(onChange);
    expect(next.format_config).toEqual({ line_height: 1.6, accent: "#1e3a8a" });
  });

  it("点第二张卡（正文）的预设写的是 text_color，不是 accent", () => {
    const onChange = renderGroup();

    openCard(1);
    fireEvent.click(presetSwatches()[2]);

    expect(lastLayout(onChange).format_config).toEqual({ text_color: "#1e3a8a" });
  });

  it("取色器只有一个实例：换一张卡时前一个卸载，卡片开合状态跟着走", () => {
    renderGroup();
    expect(document.querySelectorAll(".resume-wb-color-picker")).toHaveLength(0);

    openCard(0);
    expect(document.querySelectorAll(".resume-wb-color-picker")).toHaveLength(1);
    expect(cards()[0]).toHaveClass("is-open");
    // 只有一个预设面板（四格各挂一个取色器会渲染四份）。
    expect(presetSwatches()).toHaveLength(5);

    openCard(1);
    expect(document.querySelectorAll(".resume-wb-color-picker")).toHaveLength(1);
    expect(cards()[1]).toHaveClass("is-open");
    expect(cards()[0]).not.toHaveClass("is-open");

    // 再点同一张已打开的卡：收起。
    openCard(1);
    expect(document.querySelectorAll(".resume-wb-color-picker")).toHaveLength(0);
  });

  it("恢复默认：双击名称删掉该键（不是写回模板默认色）", () => {
    const onChange = renderGroup({
      layout: { ...BASE, format_config: { accent: "#1e3a8a", line_height: 1.6 } },
    });

    fireEvent.doubleClick(screen.getByText(ACCENT_LABEL, { selector: ".resume-wb-color-name" }));

    const next = lastLayout(onChange);
    expect(next.format_config).toEqual({ line_height: 1.6 });
    expect(next.format_config).not.toHaveProperty("accent");
  });

  it("没设过时双击名称不产生变更（没有可复位的东西）", () => {
    const onChange = renderGroup();

    fireEvent.doubleClick(screen.getByText(ACCENT_LABEL, { selector: ".resume-wb-color-name" }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("有基线且与当前不同：↺ 变成「恢复到打开时的值」，点它只搬这一个键", () => {
    const baseline: ResumeLayout = {
      ...BASE,
      format_config: { accent: "#111111", line_height: 1.4 },
    };
    const onChange = renderGroup({
      layout: { ...BASE, format_config: { accent: "#222222", line_height: 1.4 } },
      baseline,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: t("workbench.param.restoreToOpenedAria", { label: ACCENT_LABEL }),
      }),
    );

    expect(lastLayout(onChange).format_config).toEqual({
      accent: "#111111",
      line_height: 1.4,
    });
  });
});

describe("ResumeColorControls · 生效色四级链路", () => {
  it("模板配色：五张卡显示后端下发的真实色值，并标「随模板」/「随正文」", () => {
    renderGroup({ catalog: catalogWithPalette() });

    const values = cards().map((card) => card.querySelector(".resume-wb-color-value")?.textContent);
    expect(values).toEqual([
      `${CLASSIC_PALETTE.accent} · ${t("resume.measure.hintTemplate")}`,
      `${CLASSIC_PALETTE.text_color} · ${t("resume.measure.hintTemplate")}`,
      `${CLASSIC_PALETTE.muted_color} · ${t("resume.measure.hintTemplate")}`,
      `${CLASSIC_PALETTE.line_color} · ${t("resume.measure.hintTemplate")}`,
      // 第 5 格未设时显示它真正继承到的颜色（正文色），状态词是「随正文」。
      `${CLASSIC_PALETTE.text_color} · ${t("workbench.color.followBody")}`,
    ]);
    // 色块颜色经内联自定义属性下发（不是 `style.background`）。
    const chip = cards()[0].querySelector<HTMLElement>(".resume-wb-color-chip");
    expect(chip?.style.getPropertyValue("--resume-wb-chip")).toBe(CLASSIC_PALETTE.accent);
    expect(chip).not.toHaveClass("is-fallback");
  });

  it("版式预设压过模板：色值取预设，来源词变「随版式」", () => {
    const catalog: ResumeTemplateCatalog = {
      ...catalogWithPalette(),
      format_presets: [
        {
          name: "compact-preset",
          label: "紧凑预设",
          description: "",
          config: { accent: "#7f1d1d" },
        },
      ],
    };
    renderGroup({ catalog, layout: { ...BASE, format_name: "compact-preset" } });

    const value = cards()[0].querySelector(".resume-wb-color-value")?.textContent;
    expect(value).toBe(`#7f1d1d · ${t("resume.measure.hintPreset")}`);
  });

  it("自己的覆盖压过模板与预设，且不再显示来源词", () => {
    renderGroup({
      catalog: catalogWithPalette(),
      layout: { ...BASE, format_config: { accent: "#1e3a8a" } },
    });

    expect(cards()[0].querySelector(".resume-wb-color-value")?.textContent).toBe("#1e3a8a");
    expect(cards()[0].querySelector(".resume-wb-color-source")).toBeNull();
  });

  it("自制模板没有 palette：前四格斜纹占位 + 「随模板」，不编造假色值", () => {
    const catalog: ResumeTemplateCatalog = {
      ...TEMPLATE_CATALOG,
      templates: [
        ...TEMPLATE_CATALOG.templates,
        { name: "my-own", label: "我的模板", description: "" },
      ],
    };
    renderGroup({ catalog, layout: { ...BASE, template: "my-own" } });

    // 前四格走模板变量；第 5 格没有模板变量，它的状态词是「随正文」（见下一个用例）。
    for (const card of cards().slice(0, 4)) {
      expect(card.querySelector(".resume-wb-color-chip")).toHaveClass("is-fallback");
      expect(card.querySelector(".resume-wb-color-value")?.textContent).toBe(
        t("workbench.color.followTemplate"),
      );
      // 没有色值就不能再补一个来源词（否则同一句话出现两次）。
      expect(card.querySelector(".resume-wb-color-source")).toBeNull();
    }
    const entryTitle = cards()[4];
    expect(entryTitle.querySelector(".resume-wb-color-chip")).toHaveClass("is-fallback");
    expect(entryTitle.querySelector(".resume-wb-color-value")?.textContent).toBe(
      t("workbench.color.followBody"),
    );
  });

  it("非法颜色按「没设过」处理：不进入色块，也不当成用户的选择", () => {
    renderGroup({
      catalog: catalogWithPalette(),
      layout: { ...BASE, format_config: { accent: "red" } },
    });

    const chip = cards()[0].querySelector<HTMLElement>(".resume-wb-color-chip");
    expect(chip).not.toHaveClass("is-fallback");
    expect(chip?.style.getPropertyValue("--resume-wb-chip")).toBe(CLASSIC_PALETTE.accent);
    expect(cards()[0].querySelector(".resume-wb-color-value")?.textContent).toBe(
      `${CLASSIC_PALETTE.accent} · ${t("resume.measure.hintTemplate")}`,
    );
  });
});

describe("ResumeColorControls · 结构与无障碍", () => {
  it("卡片主按钮的读屏名包含：动作 + 名称 + 色值 + 来源", () => {
    renderGroup({ catalog: catalogWithPalette() });

    expect(cardMain(0)).toHaveAccessibleName(
      `${t("workbench.param.colorAria", { label: ACCENT_LABEL })} · ${CLASSIC_PALETTE.accent} · ${t("resume.measure.hintTemplate")}`,
    );
  });

  it("↺ 与主按钮平级：卡片内不存在嵌套 button", () => {
    renderGroup({ layout: { ...BASE, format_config: { accent: "#1e3a8a" } } });

    expect(cards()[0].querySelector(".resume-wb-color-main button")).toBeNull();
    const reset = cards()[0].querySelector(".resume-wb-color-reset");
    expect(reset?.parentElement).toBe(cards()[0]);
  });

  it("五个键各一张卡：前四格取目录 `format_fields` 的标签，第 5 格复用角色名", () => {
    renderGroup();

    const names = cards().map((card) => card.querySelector(".resume-wb-color-name")?.textContent);
    // 目录只下发了 accent 的 label，其余三项回落到键名（不会渲染成空标签）；
    // 第 5 格与「角色样式 → 条目标题」共用同一条词条（`typography.role.entry_title`）。
    expect(names).toEqual([
      ACCENT_LABEL,
      "text_color",
      "muted_color",
      "line_color",
      t("typography.role.entry_title"),
    ]);
  });
});

/**
 * 2×2 色卡的结构约定（jsdom 没有布局引擎，量不出真实几何，只能钉 CSS 原文）。
 *
 * 三条决定"看起来是对的四张卡"：
 * 1. 容器必须是两列 grid（不是 flex wrap：列宽会随内容抖）；
 * 2. 色块必须有 1px 边框（白色 / 浅色色块没有边框会融进卡片）；
 * 3. 旧手风琴的类名必须全部消失（`resume-wb-swatches` / `resume-wb-swatch` /
 *    `resume-wb-color-toggle`）——留着它们说明"删一半"，两条渲染路径会同时生效。
 */
describe("ResumeColorControls · 2×2 色卡样式", () => {
  function colorCss(): string {
    return readFileSync(
      [process.cwd(), "src", "styles", "resume-workbench-controls.css"].join("/"),
      "utf8",
    );
  }

  function ruleBlock(css: string, selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    expect(match, `CSS 里找不到规则：${selector}`).not.toBeNull();
    return (match as RegExpExecArray)[1];
  }

  it("容器是两列 grid，窄栏不会把卡片挤成一行", () => {
    const colors = ruleBlock(colorCss(), ".resume-wb-colors");
    expect(colors).toMatch(/display:\s*grid/);
    expect(colors).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  });

  it("色块带 1px 边框（浅色块不融进背景），颜色来自自定义属性", () => {
    const chip = ruleBlock(colorCss(), ".resume-wb-color-chip");
    expect(chip).toMatch(/border:\s*1px\s+solid/);
    expect(chip).toMatch(/background:\s*var\(--resume-wb-chip\)/);
  });

  it("旧手风琴的类名已全部删除（两条渲染路径不许并存）", () => {
    const css = colorCss();
    for (const selector of [
      ".resume-wb-swatches",
      ".resume-wb-swatch",
      ".resume-wb-color-toggle",
      ".resume-wb-color-row",
      ".resume-wb-color-head",
    ]) {
      expect(css).not.toContain(selector);
    }
  });

  it("↺ 绝对定位在卡片右上角，且只在悬停 / 聚焦时显形", () => {
    const css = colorCss();
    // 自定义 ↺ 与 ParamResetButton 共用同一条定位规则（选择器列表，两条都要在）。
    const positioned =
      /\.resume-wb-color-card > \.resume-wb-color-reset,\s*\.resume-wb-color-card > \.resume-param-restore\s*\{([^}]*)\}/.exec(
        css,
      );
    expect(positioned, "找不到 ↺ 的定位规则").not.toBeNull();
    expect(positioned?.[1]).toMatch(/position:\s*absolute/);
    expect(positioned?.[1]).toMatch(/opacity:\s*0/);
    // 悬停 / 键盘聚焦时才显形（`:focus-within` 覆盖 Tab 到主按钮与 ↺ 两种情形）。
    expect(css).toMatch(
      /\.resume-wb-color-card:hover > \.resume-wb-color-reset[\s\S]*?opacity:\s*1/,
    );
    expect(css).toMatch(
      /\.resume-wb-color-card:focus-within > \.resume-wb-color-reset[\s\S]*?opacity:\s*1/,
    );
  });
});
