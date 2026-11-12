// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import {
  buildSyncPathOptions,
  changeTitle,
  changeValueText,
  compareTargetOf,
  sortVersions,
  summarizeCompare,
  versionChangeSummary,
} from "./model";
import type { VersionChangeOut, VersionCompareOut, VersionOut } from "./types";
import type { ResumeDiff } from "../../../types/resumeWriting";
import { makeDocument, section } from "../document/documentFixtures";

function version(overrides: Partial<VersionOut> = {}): VersionOut {
  return {
    id: 1,
    resume_id: 7,
    name: "v1",
    change_summary: "",
    job_id: null,
    job_title: "",
    company: "",
    content_sha256: "",
    params_sha256: "",
    source_revision: 0,
    parent_version_id: null,
    frozen: false,
    source: "manual",
    created_at: "2026-10-20T10:00:00",
    ...overrides,
  };
}

function diff(): ResumeDiff {
  return {
    base_id: 1,
    against_id: 0,
    base_title: "v1",
    against_title: "current",
    lines: [],
    stats: { added: 2, removed: 1, unchanged: 5 },
  };
}

function change(overrides: Partial<VersionChangeOut> = {}): VersionChangeOut {
  return {
    path: "header.ob_head0001",
    kind: "changed",
    scope: "header",
    section_key: "",
    section_title: "",
    entry_id: "",
    entry_label: "",
    item_key: "name",
    item_label: "",
    old_value: "Li Si",
    new_value: "Li Wu",
    ...overrides,
  };
}

function compare(changes: VersionChangeOut[] = []): VersionCompareOut {
  return {
    base_id: 1,
    against_id: 0,
    base_name: "v1",
    against_name: "current",
    content: diff(),
    layout: { added: [], removed: [], changed: [], equal: true },
    changes,
    changes_truncated: false,
  };
}

describe("W13 纯规则", () => {
  it("版本列表新的在前，时间相同按 id 倒序", () => {
    const sorted = sortVersions([
      version({ id: 1, created_at: "2026-10-20T10:00:00" }),
      version({ id: 2, created_at: "2026-10-21T10:00:00" }),
      version({ id: 3, created_at: "2026-10-21T10:00:00" }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual([3, 2, 1]);
  });

  it("同步路径选项：按 v2 文档生成 header.<itemId> / <sectionKey>.<entryId>，空板块不列", () => {
    const document = makeDocument({
      sections: [
        section({ key: "education" }),
        section({ key: "experience", entries: [] }),
        section({ key: "skills", entries: [] }),
      ],
    });
    const options = buildSyncPathOptions(document);
    // 空板块（experience / skills）不出现。
    expect(options.some((option) => option.group === "experience")).toBe(false);
    expect(options.some((option) => option.group === "skills")).toBe(false);
    // #29c：基本信息走稳定 item id（与全站其它页眉路径同一口径）。
    expect(options.find((option) => option.path === "header.ob_head0001")).toMatchObject({
      group: "header",
      label: t("document.headerField.name"),
    });
    expect(options.some((option) => option.path === "header.name")).toBe(false);
    // 条目路径 = 板块 key + entry.id，标签取 entryDisplayLabel（标题字段值）。
    expect(options.find((option) => option.path === "education.ob_entry001")).toMatchObject({
      group: "education",
      label: "Tsinghua University",
    });
    // 不出现 v1 的下标路径。
    expect(options.some((option) => option.path === "education.0")).toBe(false);
  });

  it("同步路径选项：字段目录解析优先于本地兜底", () => {
    const document = makeDocument();
    const options = buildSyncPathOptions(document, (key) =>
      key === "name" ? "Resolved name" : undefined,
    );
    expect(options.find((option) => option.path === "header.ob_head0001")?.label).toBe(
      "Resolved name",
    );
  });

  it("比较摘要：按字段级变更计数，全等时 identical", () => {
    const digest = summarizeCompare(
      compare([
        change({ kind: "added", scope: "entry", path: "education.ob_entry009" }),
        change({ kind: "changed", path: "header.ob_head0001" }),
        change({ kind: "removed", scope: "item", path: "education.ob_entry001.ob_item0001" }),
      ]),
    );
    expect(digest).toMatchObject({
      added: 1,
      removed: 1,
      changed: 1,
      layoutChanged: 0,
      layoutEqual: true,
      identical: false,
    });
    expect(summarizeCompare(compare()).identical).toBe(true);
  });

  it("比较目标：优先父版本，其次更早一版，没有才比当前简历", () => {
    const older = version({ id: 4, created_at: "2026-10-20T10:00:00" });
    const newest = version({ id: 6, created_at: "2026-10-22T10:00:00" });
    const parented = version({
      id: 8,
      parent_version_id: 3,
      created_at: "2026-10-23T10:00:00",
    });
    const restored = version({
      id: 7,
      parent_version_id: 6,
      created_at: "2026-10-23T10:00:00",
      source: "restore",
    });
    const versions = [older, newest, restored, parented];
    // 有父版本 → 与父版本比。
    expect(compareTargetOf(versions, 8)).toBe(3);
    // 最近的版本没有父版本 → 与更早一版比（差异才有内容）。
    expect(compareTargetOf(versions, 7)).toBe(6);
    // 其它版本按时间排序后取更早一版。
    expect(compareTargetOf(versions, 6)).toBe(4);
    // 最早一版没有可比的历史版本 → 与当前简历比。
    expect(compareTargetOf(versions, 4)).toBe("current");
    // 列表里找不到（刚创建、尚未 reload）→ 与当前简历比。
    expect(compareTargetOf(versions, 999)).toBe("current");
  });

  it("字段级变更标题：字段名走本地化解析，条目新增/删除给动作名", () => {
    expect(changeTitle(change(), (key) => (key === "name" ? "Name label" : undefined))).toBe(
      "Name label",
    );
    expect(
      changeTitle(change({ scope: "entry", kind: "removed", item_key: "", entry_label: "Old" })),
    ).toBe(t("versions.compare.entry.removed"));
  });

  it("空值显示占位文案，不吞掉空字段", () => {
    expect(changeValueText(null)).toBe(t("versions.compare.value.empty"));
    expect(changeValueText("")).toBe(t("versions.compare.value.empty"));
    expect(changeValueText("text")).toBe("text");
  });

  it("变化摘要只展示服务端给的文本（不把内部 source 值当文案）", () => {
    expect(versionChangeSummary(version({ source: "restore" }))).toBe("");
    expect(versionChangeSummary(version({ change_summary: "改了标题" }))).toBe("改了标题");
  });
});
