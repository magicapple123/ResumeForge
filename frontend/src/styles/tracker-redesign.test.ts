// SPDX-License-Identifier: Apache-2.0
/**
 * Layout regression guard for the tracker page de-templating (item 13, final state).
 *
 * Reads the CSS source verbatim: the old "dashboard card" look (coloured top border +
 * shadow + card-per-row) is easy to reintroduce one property at a time, and the visual
 * result is too subtle to notice in review. Written only after both batches landed —
 * a guard on the intermediate state would lock in the half-done design.
 */
// @ts-expect-error Node builtin: @types/node is not installed, but vitest runs in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function readCss(...segments: string[]): string {
  return readFileSync([process.cwd(), "src", ...segments].join("/"), "utf8");
}

/** Comments mention the removed effects; assertions must only look at real declarations. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Extract one selector's declaration block; throws when the rule is missing. */
function ruleBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`CSS rule not found: ${selector}`);
  return match[1];
}

const board = stripCssComments(readCss("styles", "tracker-board.css"));
const summary = stripCssComments(readCss("styles", "tracker-summary.css"));

describe("tracker de-templating layout guards", () => {
  it("record rows are rows, not cards: no radius/shadow, list container owns the shell", () => {
    const card = ruleBlock(board, ".track-card");
    expect(card).toContain("border-radius: 0");
    expect(card).not.toContain("box-shadow");
    expect(card).toContain("border-bottom");
    const list = ruleBlock(board, ".tracker-list");
    expect(list).toContain("border-radius");
    expect(list).toContain("background");
  });

  it("active row keeps exactly one state signal: the 3px left bar", () => {
    // 2026-11-10 第二轮：竖条从"只有进行中"改成"所有行"——基规则画条、`.is-active` 换色。
    // 断言仍然钉住两件事：条的宽度只有一份定义（3px），且进行中用的是阶段色。
    const base = ruleBlock(board, ".track-card::before");
    expect(base).toContain("width: 3px");
    expect(ruleBlock(board, ".track-card.is-active::before")).toContain("var(--rf-stage-bar");
    // The old 6% stage tint on the whole row must stay gone.
    expect(board).not.toContain("var(--rf-info)) 6%");
  });

  it("legend is a content-width flex row: the count sits next to its label", () => {
    // `margin-left: auto` 回来就等于回到"数字被推到列尾"（实测间距 120px）。
    const legend = ruleBlock(summary, ".tracker-funnel-legend");
    expect(legend).toContain("display: flex");
    expect(legend).not.toContain("grid-template-columns");
    expect(ruleBlock(summary, ".tracker-funnel-count")).not.toContain("margin-left: auto");
    expect(ruleBlock(summary, ".tracker-funnel-step")).toContain("flex: 0 0 auto");
  });

  it("metric band has no dashboard-card chrome (top border / shadow / statistic boxes)", () => {
    expect(summary).not.toContain("box-shadow");
    expect(summary).not.toContain("border-top");
    expect(summary).not.toMatch(/\.tracker-summary\s*>\s*\.ant-statistic/);
    expect(summary).not.toContain("translateY");
    // One rounded card container remains (the merged band + composition card).
    expect(ruleBlock(summary, ".tracker-summary-card")).toContain("border-radius: 12px");
  });

  it("composition segments use flex counts, not per-segment width percentages", () => {
    expect(ruleBlock(summary, ".tracker-composition-seg")).not.toMatch(/^\s*width:/m);
    expect(ruleBlock(summary, ".tracker-funnel-stack")).toContain("gap: 2px");
  });

  it("composition legend hover no longer lifts the card", () => {
    const hover = ruleBlock(summary, ".tracker-funnel-step:hover");
    expect(hover).not.toContain("translateY");
    expect(hover).not.toContain("box-shadow");
  });
});
