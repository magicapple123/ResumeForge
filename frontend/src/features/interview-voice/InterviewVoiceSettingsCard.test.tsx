// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「面试语音」卡的滑块排版（#12）。
 *
 * 现象：五个滑块各自占满整行 → 轨道近 1000px，音量拉满时滑块头贴右缘像滚动条；
 * 400 / 1500 两个常驻 marks 让轨道看起来像刻度尺；标签与值写成「播报语速 · 1.0 倍」
 * 一整串，读屏会把它当成一个字段名。
 *
 * 这里钉四件 jsdom 能判定的事：
 * 1. 五个滑块都在、`aria-valuemin/max/now` 正确（读屏与键盘依赖它，不是装饰）；
 * 2. 标签与值**是两个节点**，页面上不再出现中间那个点；
 * 3. 常驻 marks 去掉（轨道不再被刻度挤占）；
 * 4. 两列网格与容器查询的规则确实写在样式里（布局本身量不了，规则可以）。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但本文件只在 Node（vitest）里跑。
import { readFileSync } from "node:fs";
import { App as AntdApp } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InterviewVoiceSettingsCard from "./InterviewVoiceSettingsCard";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";

// 两个远端探测都不需要真网络：拿不到时组件用内建回退表，这条用例只关心排版。
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline in test")));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderCard() {
  return render(
    <AntdApp>
      <InterviewVoiceSettingsCard />
    </AntdApp>,
  );
}

/** 样式表的原文。布局量不了（jsdom 无排版），但"规则在不在、写了什么"可以判定。 */
function readCss(): string {
  return readFileSync("src/features/interview-voice/voice-settings-grid.css", "utf8");
}

/**
 * 取某个选择器 / at-rule 的规则体（花括号配对）。
 *
 * 不能简单 `indexOf(selector)` 后截一段：`.voice-setting-field {` 是 `.voice-setting-field__head`
 * 的前缀，`@container` 后面还有别的规则，截错区间会让断言看上去通过、其实读的是别的块。
 */
function ruleBody(css: string, marker: string): string {
  const start = css.indexOf(marker);
  if (start < 0) return "";
  const open = css.indexOf("{", start);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return "";
}

/** 五个滑块的字段名（顺序与卡片里一致）。 */
const SLIDERS: { labelKey: MessageKey; min: string; max: string; now: string }[] = [
  {
    labelKey: "interviewVoice.settings.rate",
    min: "0.7",
    max: "1.5",
    now: "1",
  },
  {
    labelKey: "interviewVoice.settings.volume",
    min: "0",
    max: "1",
    now: "1",
  },
  {
    labelKey: "interviewVoice.settings.silence",
    min: "400",
    max: "1500",
    now: "700",
  },
  {
    labelKey: "interviewVoice.settings.filler",
    min: "1000",
    max: "2500",
    now: "1400",
  },
  {
    labelKey: "interviewVoice.settings.maxRecord",
    min: "60",
    max: "300",
    now: "180",
  },
];

describe("InterviewVoiceSettingsCard 滑块（#12）", () => {
  it("五个滑块的 aria-valuemin / max / now 都对得上各自区间", () => {
    renderCard();
    expect(screen.getAllByRole("slider")).toHaveLength(SLIDERS.length);

    for (const item of SLIDERS) {
      const slider = screen.getByRole("slider", { name: t(item.labelKey) });
      expect(slider).toHaveAttribute("aria-valuemin", item.min);
      expect(slider).toHaveAttribute("aria-valuemax", item.max);
      expect(slider).toHaveAttribute("aria-valuenow", item.now);
    }
  });

  it("标签与值分开渲染：不再出现「标签 · 值」一整串", () => {
    renderCard();
    const label = t("interviewVoice.settings.rate");
    const valueText = t("interviewVoice.settings.times", { value: "1.0" });

    // 两个节点各自存在……
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(valueText)).toBeInTheDocument();
    // ……但拼起来那一串不该再出现在任何元素里（旧写法是同一行的一个文本节点）。
    expect(screen.queryByText(`${label} · ${valueText}`)).toBeNull();
    // 值节点单独可控：它靠右、等宽数字，读屏可以只读值。
    expect(screen.getByText(valueText)).toHaveClass("voice-setting-field__value");
  });

  it("去掉常驻 marks：轨道不再被 400 / 1500 两个刻度占位", () => {
    const { container } = renderCard();
    expect(container.querySelector(".ant-slider-mark")).toBeNull();
  });

  it("两列网格：2 个等宽列 + 28/14 的间距 + 容器声明", () => {
    const css = readCss();
    // 两列等宽：`minmax(0,1fr)` 让长标签不会把某一列撑宽。
    expect(ruleBody(css, ".voice-settings-grid")).toMatch(
      /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(ruleBody(css, ".voice-settings-grid")).toContain("column-gap: 28px");
    expect(ruleBody(css, ".voice-settings-grid")).toContain("row-gap: 14px");
    // 容器声明：没有它，@container 规则永远不会生效。
    expect(ruleBody(css, ".voice-settings-sliders")).toContain("container-type: inline-size");

    // DOM 里最后一格带修饰类，五格都在（否则样式是死代码）。
    const { container } = renderCard();
    const fields = container.querySelectorAll(".voice-setting-field");
    expect(fields).toHaveLength(SLIDERS.length);
    expect(fields[fields.length - 1]).toHaveClass("voice-setting-field--last");
  });

  it("窄窗回落单列：容器查询阈值盖住实测的 628px 卡片宽", () => {
    const css = readCss();
    // 阈值必须是**卡片容器**宽而不是视口宽：实测视口 720 时容器 628、卡片内容区 676，
    // 按视口写 620 会漏判（628 > 620，两列留着，每格只剩 300px 调不准）。
    expect(css).toMatch(/@container\s*\(max-width:\s*(\d+)px\)/);
    const threshold = Number(/@container\s*\(max-width:\s*(\d+)px\)/.exec(css)?.[1]);
    expect(threshold).toBeGreaterThan(628);
    expect(threshold).toBe(680);

    // 光有 at-rule 不算数：块里必须真的把两列换成单列、并把最后一格的列位释放。
    const narrow = ruleBody(css, "@container");
    expect(narrow).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(narrow).not.toContain("repeat(2");
    expect(ruleBody(narrow, ".voice-setting-field--last")).toContain("grid-column: auto");
  });

  it("长说明不撑破卡片：格子与标签行都允许收缩，值不换行", () => {
    const css = readCss();
    // 两列 `minmax(0,1fr)` 的子项默认 `min-width:auto`，长标签会把列顶宽 → 卡片溢出。
    // 这是 #10 修过同一类问题，所以这里把它钉住。
    expect(ruleBody(css, ".voice-setting-field {")).toContain("min-width: 0");
    expect(ruleBody(css, ".voice-setting-field__head")).toContain("min-width: 0");
    // 值是短数字 + 单位：允许收缩的是标签，不是值（否则数字被断成两行）。
    expect(ruleBody(css, ".voice-setting-field__value")).toContain("white-space: nowrap");
    // 整块只设容器类型，不加固定宽度：宽度永远由卡片内容区决定。
    expect(ruleBody(css, ".voice-settings-sliders")).not.toMatch(/(^|\n)\s*width:/);
  });
});
