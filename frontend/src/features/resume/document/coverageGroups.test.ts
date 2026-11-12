// SPDX-License-Identifier: Apache-2.0
/**
 * 未收录清单的**纯数据整理**：5-A 的新分组键、原因推导优先级、3-A 的三分支判定。
 *
 * 这些规则以前散在组件里（甚至不存在），组件测试只能间接碰到；单独成文件后每条口径
 * 都能逐条钉住：
 * - 分组键是 `(section, section_label)`，`项目「X」的亮点` 不再并进 `项目经历`；
 * - 归一别名只用于查语言包（`section`），发给后端仍用原样键（`rawSection`）；
 * - 显式 `reasons` 优先，缺失时按 `capacity > filtered > model` 推导，三轴都不命中
 *   就是 `null`（界面显示「未说明」，不硬猜）；
 * - 「补进简历 / AI 补上这段 / 去制作台添加」的分支只由 `resolveCoverageAction` 决定。
 *
 * 本文件不含 CJK 字面量（i18n 棘轮只统计 `ByText` 里的中文，这里一条都没有）。
 */
import { describe, expect, it } from "vitest";
import type { ResumeCoverageNote } from "../../../types";
import {
  coverageReasonLabelKey,
  coverageSummaryCount,
  DEFAULT_VISIBLE_ITEMS,
  groupCoverageNotes,
  isCustomSection,
  LONG_ITEM_CHARS,
  reasonOf,
  resolveCoverageAction,
} from "./coverageGroups";

function note(overrides: Partial<ResumeCoverageNote> = {}): ResumeCoverageNote {
  return {
    section: "projects",
    section_label: "PROJECTS",
    names: [],
    filtered: [],
    model_omitted: [],
    total: 0,
    ...overrides,
  };
}

describe("groupCoverageNotes grouping key (5-A)", () => {
  it("keeps notes of one section but different section_label in separate groups", () => {
    const groups = groupCoverageNotes([
      note({ names: ["Alpha"], total: 1 }),
      note({ names: ["Alpha"], section_label: "PROJECT-ALPHA-HIGHLIGHTS", total: 6 }),
    ]);

    // The bug: only `section` was used, so 1 project name and 6 highlight lines merged
    // into one "projects (7)" row and the user could not tell them apart.
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.sectionLabel)).toEqual([
      "PROJECTS",
      "PROJECT-ALPHA-HIGHLIGHTS",
    ]);
    expect(groups.map((group) => group.total)).toEqual([1, 6]);
  });

  it("merges notes with the same (section, section_label) and sums total", () => {
    const groups = groupCoverageNotes([
      note({ names: ["Alpha"], total: 1 }),
      note({ names: ["Beta"], total: 2 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].names).toEqual(["Alpha", "Beta"]);
    expect(groups[0].total).toBe(3);
  });

  it("dedupes names inside a group while keeping first-seen order", () => {
    const groups = groupCoverageNotes([
      note({ names: ["A", "B"], total: 2 }),
      note({ names: ["B", "C"], total: 3 }),
    ]);

    expect(groups[0].items.map((item) => item.name)).toEqual(["A", "B", "C"]);
  });

  it("normalises profile-side plural keys for label lookup but keeps the raw key", () => {
    const groups = groupCoverageNotes([
      note({ section: "experiences", section_label: "EXP", names: ["Alpha"], total: 1 }),
      note({ section: "experience", section_label: "EXP", names: ["Beta"], total: 1 }),
    ]);

    // One group: the two keys are the same section once normalised (label lookup needs it).
    expect(groups).toHaveLength(1);
    expect(groups[0].section).toBe("experience");
    // The raw key survives: it is what `append-profile-entries` must receive.
    expect(groups[0].rawSection).toBe("experiences");
  });

  it("keeps group order at the first appearance in the backend array", () => {
    const groups = groupCoverageNotes([
      note({ section: "skills", section_label: "SKILLS", names: ["Excel"], total: 1 }),
      note({ names: ["Alpha"], total: 1 }),
      note({ section: "skills", section_label: "SKILLS", names: ["SQL"], total: 1 }),
    ]);

    expect(groups.map((group) => group.section)).toEqual(["skills", "projects"]);
    expect(groups[0].total).toBe(2);
  });
});

describe("reason derivation (5-A)", () => {
  it("prefers the explicit reasons map over the three arrays", () => {
    const value = note({
      names: ["Excel"],
      filtered: ["Excel"],
      model_omitted: ["Excel"],
      reasons: { Excel: "model" },
    });

    expect(reasonOf(value, "Excel")).toBe("model");
  });

  it("falls back to capacity > filtered > model for legacy records", () => {
    const value = note({
      names: ["A", "B", "C", "D"],
      capacity_omitted: ["A"],
      filtered: ["A", "B"],
      model_omitted: ["A", "B", "C"],
    });

    // A is in all three buckets -> capacity wins (it is the hardest constraint).
    expect(reasonOf(value, "A")).toBe("capacity");
    expect(reasonOf(value, "B")).toBe("filtered");
    expect(reasonOf(value, "C")).toBe("model");
    // D is in no bucket at all: the UI must say "not stated" instead of guessing.
    expect(reasonOf(value, "D")).toBeNull();
  });

  it("ignores an unknown reason value and keeps deriving from the arrays", () => {
    const value = note({
      names: ["Excel"],
      filtered: ["Excel"],
      // A future backend may add a reason axis; the read side must not crash or guess.
      reasons: { Excel: "brand_new_axis" },
    });

    expect(reasonOf(value, "Excel")).toBe("filtered");
  });

  it("counts every item exactly once in the group header buckets", () => {
    const [group] = groupCoverageNotes([
      note({
        section: "skills",
        section_label: "SKILLS",
        names: ["A", "B", "C", "D"],
        capacity_omitted: ["A", "B"],
        filtered: [],
        model_omitted: ["C"],
        total: 4,
      }),
    ]);

    const counted =
      group.reasonCounts.capacity + group.reasonCounts.filtered + group.reasonCounts.model;
    // "The numbers in the header badge add up to the number of items" (5-A acceptance).
    expect(counted + group.unknownCount).toBe(group.items.length);
    expect(group.reasonCounts).toEqual({ capacity: 2, filtered: 0, model: 1 });
    expect(group.unknownCount).toBe(1);
  });

  it("flags a group as mixed only when it carries more than one reason", () => {
    const [pure] = groupCoverageNotes([
      note({ names: ["A", "B"], filtered: ["A", "B"], total: 2 }),
    ]);
    const [mixed] = groupCoverageNotes([
      note({ names: ["A", "B"], filtered: ["A"], model_omitted: ["B"], total: 2 }),
    ]);

    expect(pure.mixedReason).toBe(false);
    expect(mixed.mixedReason).toBe(true);
  });

  it("treats 'not stated' as a distinct reason when mixing", () => {
    const [group] = groupCoverageNotes([note({ names: ["A", "B"], filtered: ["A"], total: 2 })]);

    // B has no explanation: half-explained groups still need per-row badges.
    expect(group.mixedReason).toBe(true);
  });

  it("maps every reason (including null) to a message key", () => {
    expect(coverageReasonLabelKey("filtered")).toBe("resume.coverage.reason.filtered");
    expect(coverageReasonLabelKey("capacity")).toBe("resume.coverage.reason.capacity");
    expect(coverageReasonLabelKey("model")).toBe("resume.coverage.reason.model");
    expect(coverageReasonLabelKey(null)).toBe("resume.coverage.reason.unknown");
  });
});

describe("coverageSummaryCount", () => {
  it("sums group totals (not names length) plus legacy warnings", () => {
    const count = coverageSummaryCount(
      [
        note({ names: ["Alpha"], total: 6 }),
        note({ section: "skills", section_label: "SKILLS", names: ["Excel"], total: 2 }),
      ],
      ["legacy warning"],
    );

    // Unchanged by 5-A: splitting one section into several groups must not change the total.
    expect(count).toBe(9);
  });

  it("is zero when both inputs are empty", () => {
    expect(coverageSummaryCount([], [])).toBe(0);
  });
});

describe("entry_ids union (3-A)", () => {
  it("collects the ids of every note in the group without duplicates", () => {
    const [group] = groupCoverageNotes([
      note({ section: "custom:abc", section_label: "Mine", entry_ids: ["e1", "e2"], total: 2 }),
      note({ section: "custom:abc", section_label: "Mine", entry_ids: ["e2", "e3"], total: 1 }),
    ]);

    expect(group.entryIds).toEqual(["e1", "e2", "e3"]);
  });

  it("leaves entryIds empty for legacy records that never had the field", () => {
    const [group] = groupCoverageNotes([note({ section: "custom:abc", total: 1 })]);

    expect(group.entryIds).toEqual([]);
  });
});

describe("resolveCoverageAction decision table (3-A)", () => {
  const appendable = {
    section: "custom:abc",
    rawSection: "custom:abc",
    entryIds: ["e1"],
  };

  it("uses append for a custom section whose entries can be located", () => {
    expect(resolveCoverageAction(appendable)).toBe("append");
  });

  it("falls back to the workbench for a legacy custom section without entry_ids", () => {
    // No entry_ids: we cannot locate the entry deterministically, so we must not promise
    // an insert that would probably guess the wrong record.
    expect(resolveCoverageAction({ ...appendable, entryIds: [] })).toBe("workbench");
  });

  it("keeps the AI revise button for sections that already have writable fields", () => {
    for (const section of ["skills", "languages", "summary"]) {
      expect(resolveCoverageAction({ section, rawSection: section, entryIds: ["e1"] })).toBe(
        "revise",
      );
    }
  });

  it("sends every entry-level section to the workbench", () => {
    for (const section of [
      "projects",
      "experience",
      "education",
      "awards",
      "campus_experience",
      "publications",
      "research_projects",
      "patents",
      "credentials",
    ]) {
      expect(resolveCoverageAction({ section, rawSection: section, entryIds: ["e1"] })).toBe(
        "workbench",
      );
    }
  });

  it("downgrades append to the workbench when the host cannot save", () => {
    expect(resolveCoverageAction(appendable, false)).toBe("workbench");
  });

  it("recognises the custom section prefix only", () => {
    expect(isCustomSection("custom:abc")).toBe(true);
    expect(isCustomSection("projects")).toBe(false);
  });
});

describe("display thresholds", () => {
  it("keeps 5 rows visible by default and ellipsises above 30 characters", () => {
    // Both numbers are product decisions from 5-A; pin them so a refactor cannot drift.
    // 2026-11-10（05-1）：阈值 48 → 30，与弹层 560px 内容盒的单行容量对齐——
    // 超过阈值的一律挂 Tooltip，否则 40–48 字符档"有省略号、点开没有全文"。
    expect(DEFAULT_VISIBLE_ITEMS).toBe(5);
    expect(LONG_ITEM_CHARS).toBe(30);
  });
});
