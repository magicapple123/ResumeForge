// SPDX-License-Identifier: Apache-2.0
/**
 * Heading detection for the rationale block.
 *
 * The first implementation only treated a line *ending* with a full-width colon as a
 * heading. Real generated text never looks like that -- it is always "label：body。" on
 * one line -- so the bold heading silently stopped happening on real records. These
 * cases pin the shape that actually occurs.
 */
import { describe, expect, it } from "vitest";
import {
  isHeadingParagraph,
  splitHeadingLabel,
  splitRationaleParagraphs,
} from "./rationaleParagraphs";

const COLON = "\uFF1A";
const PERIOD = "\u3002";

describe("isHeadingParagraph", () => {
  it("treats a bare label line as a heading", () => {
    expect(isHeadingParagraph(`Constraints${COLON}`)).toBe(true);
  });

  it("rejects a normal sentence", () => {
    expect(isHeadingParagraph(`Some body text${PERIOD}`)).toBe(false);
  });
});

describe("splitHeadingLabel", () => {
  it("splits a short label from its body", () => {
    // Label must stay within the eight-character budget (see the rejection case below).
    const result = splitHeadingLabel(`Facts${COLON}the model may only use given facts.`);
    expect(result).toEqual({ label: "Facts", body: "the model may only use given facts." });
  });

  it("rejects a label longer than eight characters", () => {
    expect(splitHeadingLabel(`A very long label indeed${COLON}body`)).toBeNull();
  });

  it("rejects a line without a colon", () => {
    expect(splitHeadingLabel("no colon here")).toBeNull();
  });

  it("rejects an empty body", () => {
    expect(splitHeadingLabel(`Label${COLON}   `)).toBeNull();
  });
});

describe("splitRationaleParagraphs", () => {
  it("drops blank lines so no empty paragraph is rendered", () => {
    expect(splitRationaleParagraphs(`a\n\n  \nb`)).toEqual(["a", "b"]);
  });
});
