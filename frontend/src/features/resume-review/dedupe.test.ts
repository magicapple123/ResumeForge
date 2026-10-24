// SPDX-License-Identifier: Apache-2.0
/**
 * 批注列表合并/筛选/计数测试。
 *
 * 去重键是**服务端 id**（唯一约束是 `(share_package_id, external_id)`，已在导入时处理）；
 * 这里要守住的是"再次拉取列表不会覆盖本地刚改的状态"与"筛选顺序稳定"。
 */
import { describe, expect, it } from "vitest";
import {
  filterAnnotationsByStatus,
  mergeAnnotationRecords,
  replaceAnnotationRecord,
  REVIEW_STATUS_FILTERS,
  summarizeAnnotationStatus,
} from "./dedupe";
import type { ReviewAnnotationRecord, ReviewAnnotationStatus } from "./types";

function record(
  id: number,
  status: ReviewAnnotationStatus,
  externalId = `ext-${id}`,
): ReviewAnnotationRecord {
  return {
    id,
    share_package_id: 7,
    resume_id: 3,
    document_version_id: null,
    snapshot_sha256: "c".repeat(64),
    external_id: externalId,
    object_id: "ob_aaaaaaaaaaaa",
    point_id: null,
    path: null,
    field: null,
    quoted_text: "",
    text: `第 ${id} 条批注`,
    reviewer: "李老师",
    status,
    resolved_at: status === "resolved" ? "2026-10-24T00:00:00Z" : null,
    created_at: "2026-10-24T00:00:00Z",
  };
}

describe("mergeAnnotationRecords", () => {
  it("按服务端 id 去重；已存在项保留原对象（不覆盖本地刚改的状态）", () => {
    const local = [record(1, "resolved"), record(2, "open")];
    const fetched = [record(1, "open"), record(3, "stale")];
    const merged = mergeAnnotationRecords(local, fetched);
    expect(merged.annotations.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(merged.annotations[0].status).toBe("resolved");
    expect(merged.added).toBe(1);
    expect(merged.duplicates).toBe(1);
  });

  it("空列表合并返回原样", () => {
    const local = [record(1, "open")];
    const merged = mergeAnnotationRecords(local, []);
    expect(merged).toMatchObject({ added: 0, duplicates: 0 });
    expect(merged.annotations).toEqual(local);
  });
});

describe("replaceAnnotationRecord", () => {
  it("只替换同 id 的一条，其余保持引用", () => {
    const first = record(1, "open");
    const second = record(2, "open");
    const updated = { ...first, status: "resolved" as const };
    const next = replaceAnnotationRecord([first, second], updated);
    expect(next[0]).toEqual(updated);
    expect(next[1]).toBe(second);
  });
});

describe("筛选与计数", () => {
  const records = [
    record(1, "open"),
    record(2, "open"),
    record(3, "resolved"),
    record(4, "stale"),
    record(5, "dismissed"),
  ];

  it("按状态筛选；all 返回副本", () => {
    expect(filterAnnotationsByStatus(records, "open").map((item) => item.id)).toEqual([1, 2]);
    expect(filterAnnotationsByStatus(records, "stale").map((item) => item.id)).toEqual([4]);
    const all = filterAnnotationsByStatus(records, "all");
    expect(all).toEqual(records);
    expect(all).not.toBe(records);
  });

  it("头部计数覆盖四种状态", () => {
    expect(summarizeAnnotationStatus(records)).toEqual({
      total: 5,
      open: 2,
      resolved: 1,
      stale: 1,
      dismissed: 1,
    });
  });

  it("筛选项固定顺序（UI 与测试共用一份）", () => {
    expect(REVIEW_STATUS_FILTERS).toEqual(["all", "open", "resolved", "stale", "dismissed"]);
  });
});
