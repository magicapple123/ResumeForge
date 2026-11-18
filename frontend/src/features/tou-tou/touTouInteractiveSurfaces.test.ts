// SPDX-License-Identifier: Apache-2.0
// @ts-expect-error Node types are intentionally absent from the browser TypeScript project.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("interactive surfaces inside the pointer-transparent orb shell", () => {
  it.each([
    ["tou-tou-panel.css", "tt-panel-overlay"],
    ["tou-tou-proposal.css", "tt-proposal"],
  ])("%s explicitly restores pointer events", (file, selector) => {
    const css = readFileSync(new URL(file, import.meta.url), "utf8");
    const block = css.split(`.${selector} {`)[1]?.split("}")[0] ?? "";
    expect(block).toContain("pointer-events: auto;");
  });
});

describe("划词浮条层级（DF-1）", () => {
  const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

  /** 从样式表里取一档数值 token；缺了就报名字，避免正则失配后拿 NaN 当通过。 */
  const tokenOf = (css: string, name: string): number => {
    const found = new RegExp(`--${name}:\\s*(\\d+);`).exec(css);
    if (!found) throw new Error(`缺少 token --${name}`);
    return Number(found[1]);
  };

  it("三处基准的数值对照：浅色 token / 深色 token / 投投卡片三档", () => {
    const light = read("../../theme/design-tokens.css");
    const dark = read("../../theme/dark-tokens.css");

    // 深色只换颜色，不覆写任何一档层级——所以浅色文件是这组数值的唯一来源。
    expect(dark).not.toMatch(/--rf-layer-/);

    // 逐项对照：浮条 3300 落在「编辑器 Modal 3110 / 单层容器链 3200」之上，
    // 「助手卡 3400 / 保存卡 3450 / 剪贴板卡 3500」之下。写死期望值是为了让
    // 任何一档被顺手改动时，差异直接出现在这张表里，而不是散成多条不等式。
    expect({
      划词浮条: tokenOf(light, "rf-layer-selection-bar"),
      编辑器Modal: tokenOf(light, "rf-layer-editor-modal"),
      单层容器链: tokenOf(light, "rf-layer-popup-base") + 100,
      助手卡: tokenOf(light, "rf-layer-assistant-card"),
      保存卡: tokenOf(light, "rf-layer-save-card"),
      剪贴板卡: tokenOf(light, "rf-layer-clipboard-card"),
    }).toEqual({
      划词浮条: 3300,
      编辑器Modal: 3110,
      单层容器链: 3200,
      助手卡: 3400,
      保存卡: 3450,
      剪贴板卡: 3500,
    });
  });

  it("浮条只站在「单层容器链之上、全部卡片之下」这一档", () => {
    const light = read("../../theme/design-tokens.css");
    const selection = read("./tou-tou-selection.css");
    const bar = tokenOf(light, "rf-layer-selection-bar");

    expect(selection).toContain("z-index: var(--rf-layer-selection-bar);");
    expect(bar).toBeGreaterThan(tokenOf(light, "rf-layer-editor-modal"));
    expect(bar).toBeGreaterThan(tokenOf(light, "rf-layer-popup-base") + 100);
    // 三张卡片都要压得住浮条：浮条不许盖住由它触发的卡片。
    for (const card of [
      "rf-layer-assistant-card",
      "rf-layer-save-card",
      "rf-layer-clipboard-card",
    ]) {
      expect(bar, card).toBeLessThan(tokenOf(light, card));
    }
  });
});
