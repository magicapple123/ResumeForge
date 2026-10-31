// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { computeFieldDiff } from "./resumeFieldDiff";
import { summarizeDraftDiff } from "./draftDiff";
import {
  makeResumeDocument,
  makeEntry,
  makeSection,
  defaultFieldItem,
  defaultAuthorsItem,
} from "../test/documentHarness";

describe("native document comparisons", () => {
  it("compares header values and keeps photo bytes out of the result", () => {
    const before = makeResumeDocument();
    const after = structuredClone(before);
    after.header.items[0].value = "Synthetic replacement";
    const result = computeFieldDiff(before, after, "A", "B");
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0]).toMatchObject({
      type: "string",
      key: "header.name",
      newText: "Synthetic replacement",
    });
    expect(summarizeDraftDiff(before, after)[0].after).toBe("Synthetic replacement");
    expect(before.header.items[0].value).not.toBe(after.header.items[0].value);
  });

  it("includes custom hidden values and author flags with their stable paths", () => {
    const before = makeResumeDocument();
    before.sections.push(
      makeSection(
        "custom:diff",
        "entries",
        [
          makeEntry(
            [
              defaultFieldItem({
                id: "it_diffcustom01",
                key: "custom",
                label: "Synthetic custom",
                value: "Old",
                placement: "hidden",
              }),
              defaultAuthorsItem({
                id: "it_diffauthor01",
                key: "authors",
                authors: [{ name: "Synthetic Author", is_self: false, corresponding: false }],
              }),
            ],
            { id: "ob_diffcustom01" },
          ),
        ],
        { title: "Synthetic section" },
      ),
    );
    const after = structuredClone(before);
    const items = after.sections[after.sections.length - 1].entries[0].items;
    if (items[0].kind === "field") items[0].value = "New";
    if (items[1].kind === "authors") items[1].authors[0].corresponding = true;
    const result = computeFieldDiff(before, after, "A", "B");
    expect(result.changed.map((row) => row.key)).toEqual([
      "custom:diff.ob_diffcustom01.it_diffcustom01",
      "custom:diff.ob_diffcustom01.it_diffauthor01",
    ]);
    expect(result.changed[0].label).toContain("Synthetic custom");
  });

  it("reports native item position and order changes", () => {
    const before = makeResumeDocument();
    const after = structuredClone(before);
    const item = after.sections[0].entries[0].items[0];
    if (item.kind !== "text") item.placement = "trail";
    after.sections[0].entries[0].items.reverse();
    const result = computeFieldDiff(before, after, "A", "B");
    expect(result.changed.length).toBeGreaterThan(0);
    expect(result.changed.some((row) => row.key.endsWith(item.id))).toBe(true);
  });
});
