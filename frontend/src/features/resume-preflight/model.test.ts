// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  compareRecheck,
  countBySeverity,
  filterBlockersOnly,
  groupIssues,
  isSnapshotStale,
  locatorSummary,
  snapshotKey,
} from "./model";
import { makeIssue, makeSnapshot } from "../../test/preflightFixtures";

describe("检查结果纯规则（W11）", () => {
  it("严重度计数", () => {
    expect(
      countBySeverity([
        makeIssue({ severity: "blocker" }),
        makeIssue({ severity: "verify" }),
        makeIssue({ severity: "verify" }),
      ]),
    ).toEqual({ blocker: 1, verify: 2, suggestion: 0, total: 3 });
  });

  it("三层顺序固定，组内 blocker 在前、同级别保持后端顺序", () => {
    const verify = makeIssue({ id: "v1", layer: "layout", severity: "verify" });
    const blocker = makeIssue({ id: "b1", layer: "layout", severity: "blocker" });
    const product = makeIssue({ id: "p1", layer: "product", severity: "suggestion" });
    const content = makeIssue({ id: "c1", layer: "content", severity: "verify" });
    const groups = groupIssues([verify, product, blocker, content]);
    expect(groups.map((group) => group.layer)).toEqual(["content", "layout", "product"]);
    expect(groups[1].issues.map((issue) => issue.id)).toEqual(["b1", "v1"]);
  });

  it("只显示必须解决", () => {
    const issues = [makeIssue({ severity: "blocker" }), makeIssue({ severity: "verify" })];
    expect(filterBlockersOnly(issues, true)).toHaveLength(1);
    expect(filterBlockersOnly(issues, false)).toHaveLength(2);
  });

  it("快照指纹：任何字段变化都算过时", () => {
    const snapshot = makeSnapshot();
    expect(snapshotKey(snapshot)).toBe(snapshotKey(makeSnapshot()));
    expect(isSnapshotStale(snapshot, makeSnapshot())).toBe(false);
    expect(isSnapshotStale(snapshot, makeSnapshot({ content_sha256: "content-b" }))).toBe(true);
    expect(isSnapshotStale(snapshot, makeSnapshot({ page_limit: 3 }))).toBe(true);
    expect(isSnapshotStale(snapshot, null)).toBe(true);
  });

  it("复检比对按 issue.id 分成新增/仍在/已解决", () => {
    const keep = makeIssue({ id: "keep" });
    const gone = makeIssue({ id: "gone" });
    const added = makeIssue({ id: "added" });
    const comparison = compareRecheck([keep, gone], [keep, added]);
    expect(comparison.remaining.map((issue) => issue.id)).toEqual(["keep"]);
    expect(comparison.resolved.map((issue) => issue.id)).toEqual(["gone"]);
    expect(comparison.added.map((issue) => issue.id)).toEqual(["added"]);
  });

  it("定位说明拼接板块/字段/路径/页码（缺省为空串）", () => {
    expect(
      locatorSummary(
        makeIssue({
          locator: { scope: "field", section: "experience", field: "description", page: 2 },
        }),
      ),
    ).toBe("experience · description · 2");
    expect(locatorSummary(makeIssue({ locator: { scope: "document" } }))).toBe("");
  });
});
