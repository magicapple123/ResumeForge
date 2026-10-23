// SPDX-License-Identifier: Apache-2.0
/**
 * 参数 · **外观**组：四个颜色键的写入语义（P1-1）。
 *
 * 这一组是本轮"后端早就支持、前端没有入口"的五项里最容易接错的一项：颜色不是滑杆，
 * 没有 `line_height` 那样的既有实现可抄，而三条性质都只在出错时可见：
 *
 * 1. 一次取色**只写自己那个键**（写错成整份 `format_config` 覆盖 = 把别人调好的行距
 *    一起抹掉）；
 * 2. 恢复默认 = **删键**（写回"模板默认色"会让以后模板换配色时这些简历不跟着变）；
 * 3. 探针与后端 `format_css` 的 `:root` 声明**逐字一致**（`:root { --accent: #1e3a8a; }`），
 *    否则松手后颜色会跳一下。
 *
 * 断言文案一律走 `t()` 或取目录里的 `label`；中文只出现在注释里（`cjkRatchet` 口径）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import { t } from "../../i18n";
import type { ResumeLayout } from "../../types";
import { DEFAULT_LAYOUT, makePreviewRef } from "../ResumeLayoutControls.testkit";
import ResumeColorControls from "./ResumeColorControls";

declare const process: { cwd(): string };

/** 强调色那一行的标签由目录下发（`format_fields[].label` 只有一份来源）。 */
const ACCENT_LABEL =
  TEMPLATE_CATALOG.format_fields?.find((field) => field.key === "accent")?.label ?? "accent";

const BASE: ResumeLayout = { ...DEFAULT_LAYOUT, format_config: {} };

function renderGroup(
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

/** 第一行（强调色）的预设色板：色块顺序与 `PALETTE` 一致。 */
function firstRowSwatches(): HTMLElement[] {
  const palettes = screen.getAllByRole("group", { name: t("workbench.color.palette") });
  return within(palettes[0]).getAllByRole("button");
}

function lastLayout(onChange: ReturnType<typeof vi.fn>): ResumeLayout {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]?.[0] as ResumeLayout;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ResumeColorControls · 写入语义", () => {
  it("点色板：只写 accent，其它覆盖原样保留，并先注入逐字一致的探针", () => {
    const { ref, setLiveProbe } = makePreviewRef();
    const onChange = renderGroup({
      layout: { ...BASE, format_config: { line_height: 1.6 } },
      previewRef: ref,
    });

    const navy = firstRowSwatches()[2];
    expect(navy).toHaveAttribute("aria-label", t("workbench.color.navy"));
    fireEvent.click(navy);

    // 探针 = 后端 `format_css` 的 `:root` 声明（同一串字符）。
    expect(setLiveProbe).toHaveBeenCalledWith(":root { --accent: #1e3a8a; }");
    const next = lastLayout(onChange);
    expect(next.format_config).toEqual({ line_height: 1.6, accent: "#1e3a8a" });
  });

  it("恢复默认：双击标题删掉该键（不是写回模板默认色）", () => {
    const onChange = renderGroup({
      layout: { ...BASE, format_config: { accent: "#1e3a8a", line_height: 1.6 } },
    });

    fireEvent.doubleClick(
      screen.getByRole("button", {
        name: t("workbench.param.resetLabel", { label: ACCENT_LABEL }),
      }),
    );

    const next = lastLayout(onChange);
    expect(next.format_config).toEqual({ line_height: 1.6 });
    expect(next.format_config).not.toHaveProperty("accent");
  });

  it("没设过时双击标题不产生变更（没有可复位的东西）", () => {
    const onChange = renderGroup();

    fireEvent.doubleClick(
      screen.getByRole("button", {
        name: t("workbench.param.resetLabel", { label: ACCENT_LABEL }),
      }),
    );

    expect(onChange).not.toHaveBeenCalled();
  });

  it("已设过的颜色：对应的色块标为按下，来源胶囊不再出现", () => {
    renderGroup({ layout: { ...BASE, format_config: { accent: "#1e3a8a" } } });

    const navy = firstRowSwatches()[2];
    expect(navy).toHaveAttribute("aria-pressed", "true");
    // 另外四个色块不是当前值。
    expect(firstRowSwatches()[0]).toHaveAttribute("aria-pressed", "false");
    // 自定义状态下**这一行**不再显示「随模板 / 随版式」：那一格是空字符串（占位仍在）。
    const accentRow = screen
      .getByRole("button", {
        name: t("workbench.param.resetLabel", { label: ACCENT_LABEL }),
      })
      .closest(".resume-wb-color-row") as HTMLElement;
    expect(accentRow).not.toBeNull();
    expect(within(accentRow).queryByText(t("resume.measure.hintTemplate"))).not.toBeInTheDocument();
  });

  it("配置里存着非法颜色（手工请求写坏的）时按「没设过」处理", () => {
    renderGroup({ layout: { ...BASE, format_config: { accent: "red" } } });

    // 读数是占位符而不是 `red`：非法值不进入探针，也不当成用户的选择。
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(firstRowSwatches()[0]).toHaveAttribute("aria-pressed", "false");
  });

  it("四个颜色键各自一行，标签优先取目录 `format_fields`", () => {
    renderGroup();

    expect(
      screen.getByRole("button", {
        name: t("workbench.param.resetLabel", { label: ACCENT_LABEL }),
      }),
    ).toBeInTheDocument();
    // 目录未下发 label 的三项回落到键名（不会渲染成空标签）。
    for (const key of ["text_color", "muted_color", "line_color"]) {
      expect(
        screen.getByRole("button", {
          name: t("workbench.param.resetLabel", { label: key }),
        }),
      ).toBeInTheDocument();
    }
  });
});

/**
 * 色板行对齐（2026-11 用户截图）。
 *
 * 症状是"下面那排色块比上面那行控件宽、右边界对不齐，四组之间还各偏一点"。jsdom 没有
 * 布局引擎，量不出真实几何，所以这里钉**结构与样式原文**——恰恰是这三条决定了结果：
 *
 * 1. 色板必须是**行 grid 的直接子级**（中间再包一层，列宽就由内容各自决定）；
 * 2. 行是四列 grid、`head` 是 `display: contents`（四段直接落进列里）；
 * 3. 色板跨 `2 / -1`（左边界 = 取色器，右边界 = 行尾），标签列由**一个共用变量**定宽
 *    （四行才会共用同一条起跑线）。
 */
describe("ResumeColorControls · 色板行对齐", () => {
  function colorCss(): string {
    return readFileSync(
      [process.cwd(), "src", "styles", "resume-workbench-controls.css"].join("/"),
      "utf8",
    );
  }

  /** 取某条选择器的声明块；找不到直接抛错（改名/删规则时用例立刻红，不会静默通过）。 */
  function ruleBlock(css: string, selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    expect(match, `CSS 里找不到规则：${selector}`).not.toBeNull();
    return (match as RegExpExecArray)[1];
  }

  it("色板与控件头都是行 grid 的直接子级（中间不许再包一层）", () => {
    renderGroup();

    const rows = Array.from(document.querySelectorAll<HTMLElement>(".resume-wb-color-row"));
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.querySelector(".resume-wb-color-head")?.parentElement).toBe(row);
      expect(row.querySelector(".resume-wb-swatches")?.parentElement).toBe(row);
    }
  });

  it("行是四列 grid，head 用 display: contents 让四段落进列里", () => {
    const css = colorCss();

    const row = ruleBlock(css, ".resume-wb-color-row");
    expect(row).toMatch(/display:\s*grid/);
    // 四列：标签 / 取色器 / 读数 / 来源。标签列用共用变量，不是各行自己的 auto。
    expect(row).toMatch(
      /grid-template-columns:\s*var\(--resume-wb-color-label-w\)\s+auto\s+minmax\(0,\s*1fr\)\s+auto/,
    );
    expect(ruleBlock(css, ".resume-wb-color-head")).toMatch(/display:\s*contents/);
  });

  it("色板跨「取色器 → 行尾」，左右边界因此与上面那行重合", () => {
    const css = colorCss();

    const swatches = ruleBlock(css, ".resume-wb-swatches");
    expect(swatches).toMatch(/grid-column:\s*2\s*\/\s*-1/);
    // 当初"色板比上面那行左移 2px"就是这条 padding 造成的；留着它左边界永远差 2px。
    expect(swatches).not.toMatch(/padding-left/);
  });

  it("标签列由共用的自定义属性定宽（四行同一条起跑线）", () => {
    const css = colorCss();

    expect(css).toMatch(/\.resume-wb-rows\s*\{[^}]*--resume-wb-color-label-w:\s*\d+px/);
    // 不许退回 `max-content`：每行都是独立的 grid，各算各的列宽就又错开了。
    expect(ruleBlock(css, ".resume-wb-color-row")).not.toMatch(/max-content/);
  });

  it("没有用 !important 硬压", () => {
    const css = colorCss();
    for (const selector of [
      ".resume-wb-color-row",
      ".resume-wb-color-head",
      ".resume-wb-swatches",
    ]) {
      expect(ruleBlock(css, selector)).not.toMatch(/!important/);
    }
  });
});
