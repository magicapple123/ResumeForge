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
