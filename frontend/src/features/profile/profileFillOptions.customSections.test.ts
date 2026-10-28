// SPDX-License-Identifier: Apache-2.0
/**
 * 自建板块（custom:*）的条目级候选（2026-10-28）。
 *
 * 后端投影已经为自建板块生成 candidates，paper_content_path 是
 * `custom_sections/<完整 section key>/entries/<i>`（4 段），与系统分区的
 * `field/index` 不同。本文件钉住三件事：
 * 1. **按完整 section key 分桶**（`custom:<id>`），value 直接取投影 content 里的现成
 *    `{entry_id, text, lines}`（R-16/R-37 单源，不按标题猜）；
 * 2. **身份与形状键分开**：key = entry_id（稳定身份），matchKey = text+lines 形状
 *    （用于识别"表单里已经有了"）；
 * 3. **旧投影降级**：没有 content / 没有 candidates 时返回空桶，入口不渲染。
 *
 * 夹具标题用 ASCII：这些是数据、不是产品文案。
 */
import { describe, expect, it } from "vitest";
import { emptyProjection } from "../../test/profileProjectionFixture";
import type { PaperProjectionOut } from "../profile-library/types";
import type { ResumeContent, ResumeCustomEntry } from "../../types";
import { buildProfileFillSources, customEntryFillKey } from "./profileFillOptions";

const OSS_KEY = "custom:oss";
const TALK_KEY = "custom:talks";

/** 投影 content 里的自建板块（后端 `_project_custom_section` 的形状）。 */
function customContent(): ResumeContent {
  return {
    ...emptyProjection().content,
    custom_sections: [
      {
        key: OSS_KEY,
        title: "OSS",
        entries: [
          {
            entry_id: "e-oss-0",
            text: "Keep OSS alive",
            lines: [
              { label: "Role", value: "maintainer" },
              { label: "Link", value: "https://example.dev" },
            ],
          },
          { entry_id: "e-oss-1", text: "Second entry", lines: [] },
        ],
      },
      {
        key: TALK_KEY,
        title: "Talks",
        entries: [{ entry_id: "e-talk-0", text: "", lines: [{ label: "Venue", value: "PyCon" }] }],
      },
    ],
  };
}

function candidate(
  sectionKey: string,
  sectionName: string,
  entryId: string,
  title: string,
  path: string,
): PaperProjectionOut["candidates"][number] {
  return {
    section_key: sectionKey,
    section_name: sectionName,
    entry_id: entryId,
    title,
    subtitle: sectionName,
    paper_content_path: path,
  };
}

/** 一份带两个自建板块候选的投影（外加一条 system 候选与一条空路径候选）。 */
function customProjection(): PaperProjectionOut {
  const content = customContent();
  return {
    ...emptyProjection(),
    content,
    candidates: [
      candidate(
        OSS_KEY,
        "OSS",
        "e-oss-0",
        "Keep OSS alive",
        `custom_sections/${OSS_KEY}/entries/0`,
      ),
      candidate(OSS_KEY, "OSS", "e-oss-1", "Second entry", `custom_sections/${OSS_KEY}/entries/1`),
      // 空条目在投影里没有位置（path 为空）：不能成为候选。
      candidate(OSS_KEY, "OSS", "e-oss-2", "", ""),
      // 同一份资料重复出现（旧后端 / 分页拼接）：按 entry_id 只留一条。
      candidate(OSS_KEY, "OSS", "e-oss-0", "Duplicate", `custom_sections/${OSS_KEY}/entries/0`),
      candidate(TALK_KEY, "Talks", "e-talk-0", "PyCon", `custom_sections/${TALK_KEY}/entries/0`),
    ],
  };
}

function ossEntry(content: ResumeContent, index: number): ResumeCustomEntry {
  return content.custom_sections![0].entries[index];
}

describe("buildProfileFillSources · 自建板块候选桶", () => {
  it("按完整 section key 分桶，value 是投影 content 里的同一条（同引用、不重拼）", () => {
    const data = customProjection();
    const sources = buildProfileFillSources(data);
    const bucket = sources.customSections?.[OSS_KEY] ?? [];

    expect(bucket).toHaveLength(2);
    expect(bucket[0].key).toBe("e-oss-0");
    expect(bucket[0].value).toBe(ossEntry(data.content, 0));
    expect(bucket[1].key).toBe("e-oss-1");
    expect(bucket[1].value).toBe(ossEntry(data.content, 1));
    // 标签/说明来自服务端候选 title/subtitle，前端不重算。
    expect(bucket[0].label).toBe("Keep OSS alive");
    expect(bucket[0].hint).toBe("OSS");
    // matchKey 是形状键：text + 非空「标签：值」行。
    expect(bucket[0].matchKey).toBe(customEntryFillKey(ossEntry(data.content, 0)));
  });

  it("第二个自建板块单独分桶；只有标签行的条目也能成为候选", () => {
    const data = customProjection();
    const sources = buildProfileFillSources(data);
    const talks = sources.customSections?.[TALK_KEY] ?? [];
    const talksEntry = data.content.custom_sections?.find((section) => section.key === TALK_KEY)
      ?.entries[0];

    expect(talks).toHaveLength(1);
    expect(talks[0].key).toBe("e-talk-0");
    expect(talks[0].value).toBe(talksEntry);
    expect(talks[0].matchKey).toBe(
      customEntryFillKey({ text: "", lines: [{ label: "Venue", value: "PyCon" }] }),
    );
  });

  it("空路径 / 重复 entry_id 的候选被跳过；系统分区不会混进自建桶", () => {
    const sources = buildProfileFillSources(customProjection());
    const allKeys = Object.keys(sources.customSections ?? {});

    expect(allKeys.sort()).toEqual([OSS_KEY, TALK_KEY].sort());
    expect(sources.customSections?.[OSS_KEY]).toHaveLength(2);
    // 系统桶仍是空数组（没有对应 candidates），不受自建候选影响。
    expect(sources.education).toEqual([]);
  });

  it("没有 content / 没有 candidates 的旧投影：返回空桶，入口不渲染", () => {
    const empty = emptyProjection();
    expect(buildProfileFillSources(empty).customSections).toEqual({});
    expect(buildProfileFillSources({ ...empty, candidates: [] }).customSections).toEqual({});
  });
});

describe("customEntryFillKey · 自建条目形状键", () => {
  it("行顺序不参与：内容相同就是同一条资料", () => {
    const ordered = customEntryFillKey({
      text: "Alpha",
      lines: [
        { label: "Role", value: "maintainer" },
        { label: "Link", value: "https://x.dev" },
      ],
    });
    const reordered = customEntryFillKey({
      text: "Alpha",
      lines: [
        { label: "Link", value: "https://x.dev" },
        { label: "Role", value: "maintainer" },
      ],
    });
    expect(reordered).toBe(ordered);
  });

  it("空白行（对齐补出的空字段）不参与：与投影只写有值行的口径一致", () => {
    const filled = customEntryFillKey({
      text: "Alpha",
      lines: [{ label: "Role", value: "maintainer" }],
    });
    const aligned = customEntryFillKey({
      text: "Alpha",
      lines: [
        { label: "Role", value: "maintainer" },
        { label: "Link", value: "" },
        { label: "  ", value: "   " },
      ],
    });
    expect(aligned).toBe(filled);
  });

  it("entry_id 不参与形状键；text / 行值变化会改变键，多余空白被归一化", () => {
    const base = { text: "Alpha", lines: [{ label: "Role", value: "maintainer" }] };
    const withEntryId = (entryId: string) => ({ entry_id: entryId, ...base });
    expect(customEntryFillKey(withEntryId("a"))).toBe(customEntryFillKey(withEntryId("b")));
    expect(customEntryFillKey({ ...base, text: "Beta" })).not.toBe(customEntryFillKey(base));
    expect(customEntryFillKey({ ...base, lines: [{ label: "Role", value: "author" }] })).not.toBe(
      customEntryFillKey(base),
    );
    expect(customEntryFillKey({ text: "  Alpha  ", lines: base.lines })).toBe(
      customEntryFillKey(base),
    );
  });

  it("text 与空白行全空时键为空（isBlankKey 判定用）", () => {
    expect(customEntryFillKey({ text: "", lines: [] })).toBe("");
    expect(customEntryFillKey({ text: "   ", lines: [{ label: "Link", value: " " }] })).toBe("");
    expect(customEntryFillKey(null)).toBe("");
  });
});
