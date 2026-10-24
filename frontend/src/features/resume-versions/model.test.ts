// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  buildSyncPathOptions,
  sortVersions,
  summarizeCompare,
  versionChangeSummary,
} from "./model";
import type { VersionCompareOut, VersionOut } from "./types";
import type { ResumeDiff } from "../../types/resumeWriting";

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

describe("W13 纯规则", () => {
  it("版本列表新的在前，时间相同按 id 倒序", () => {
    const sorted = sortVersions([
      version({ id: 1, created_at: "2026-10-20T10:00:00" }),
      version({ id: 2, created_at: "2026-10-21T10:00:00" }),
      version({ id: 3, created_at: "2026-10-21T10:00:00" }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual([3, 2, 1]);
  });

  it("同步路径选项：排除照片；数组板块按条目展开并取可辨认标签", () => {
    const options = buildSyncPathOptions({
      photo: "data:image/png;base64,AAAA",
      summary: "后端",
      skills: [{ name: "Python" }],
      experience: [{ company: "云梯", role: "工程师" }, { role: "架构师" }],
    });
    expect(options.some((option) => option.path === "photo")).toBe(false);
    expect(options.find((option) => option.path === "summary")?.label).toBe("后端");
    expect(options.find((option) => option.path === "experience.0")?.label).toBe("云梯");
    expect(options.find((option) => option.path === "experience.1")?.label).toBe("架构师");
    expect(options.find((option) => option.path === "skills.0")?.label).toBe("Python");
  });

  it("比较摘要：正文行数 + 排版键差异，全等时 identical", () => {
    const compare: VersionCompareOut = {
      base_id: 1,
      against_id: 0,
      base_name: "v1",
      against_name: "current",
      content: diff(),
      layout: { added: ["page_limit"], removed: [], changed: ["template"], equal: false },
    };
    const digest = summarizeCompare(compare);
    expect(digest).toMatchObject({
      contentAdded: 2,
      contentRemoved: 1,
      layoutChanged: 2,
      layoutEqual: false,
      identical: false,
    });
    const equal = summarizeCompare({
      ...compare,
      content: { ...diff(), stats: { added: 0, removed: 0, unchanged: 5 } },
      layout: { added: [], removed: [], changed: [], equal: true },
    });
    expect(equal.identical).toBe(true);
  });

  it("变化摘要只展示服务端给的文本（不把内部 source 值当文案）", () => {
    expect(versionChangeSummary(version({ source: "restore" }))).toBe("");
    expect(versionChangeSummary(version({ change_summary: "改了标题" }))).toBe("改了标题");
  });
});
