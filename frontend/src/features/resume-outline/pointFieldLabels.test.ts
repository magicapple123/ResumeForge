// SPDX-License-Identifier: Apache-2.0
/**
 * 字段标签的**文案表与判定**（QA 补充，钉住两件硬要求）。
 *
 * 1. 表里登记的每个 key 必须在 `zh-CN` / `en-US` **两边都存在**、非空、且值不是 key 本身；
 *    否则大纲行上会出现 `editor.field.techStack` 这种机器码，或者中英只有一个语言能显示。
 * 2. `pointFieldLabelKey` 查不到时必须返回 `null`（= 这一行不显示标签），**绝不能**回退成
 *    `pointField` 原值——`tech_stack` / `manual_page_break` 这类机器码印到界面上是既有教训。
 */
import { describe, expect, it } from "vitest";
import enUS from "../../i18n/messages/en-US";
import zhCN from "../../i18n/messages/zh-CN";
import type { OutlinePoint } from "./model";
import {
  POINT_FIELD_LABEL_KEYS,
  needsPointFieldTags,
  pointFieldGroupLeaders,
  pointFieldLabelKey,
} from "./pointFieldLabels";
import type { EntryField } from "./types";

/** 表里所有 `(分区, 要点字段, key)` 三元组。 */
function allEntries(): { field: EntryField; pointField: string; key: string }[] {
  const rows: { field: EntryField; pointField: string; key: string }[] = [];
  for (const [field, mapping] of Object.entries(POINT_FIELD_LABEL_KEYS)) {
    for (const [pointField, key] of Object.entries(mapping)) {
      rows.push({ field: field as EntryField, pointField, key });
    }
  }
  return rows;
}

function point(
  points: Partial<OutlinePoint> & Pick<OutlinePoint, "pointField" | "pointId">,
): OutlinePoint {
  return { index: 0, text: "", hidden: false, ...points } as OutlinePoint;
}

describe("字段标签文案表：7 个 key 两边都要有真译文", () => {
  it("表里正好登记 7 条（教育 2 + 工作 1 + 校园 1 + 项目 3）", () => {
    expect(allEntries()).toHaveLength(7);
    expect(
      allEntries()
        .map((row) => row.key)
        .sort(),
    ).toEqual([
      "editor.field.campusDescription",
      "editor.field.courses",
      "editor.field.expDescription",
      "editor.field.highlights",
      "editor.field.projectDescription",
      "editor.field.studyAchievements",
      "editor.field.techStack",
    ]);
  });

  it("每个 key 在 zh-CN / en-US 都存在、非空、且值不是 key 本身", () => {
    const problems: string[] = [];
    for (const { field, pointField, key } of allEntries()) {
      for (const [locale, pack] of [
        ["zh-CN", zhCN],
        ["en-US", enUS],
      ] as const) {
        const value = (pack as Record<string, string>)[key];
        if (typeof value !== "string" || value.trim() === "") {
          problems.push(`${locale} 缺少 key：${key}（${field}.${pointField}）`);
          continue;
        }
        if (value === key) problems.push(`${locale} 的值就是 key 本身：${key}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("中英文案不相等（防把英文抄进中文包）", () => {
    const same = allEntries()
      .filter(({ key }) => zhCN[key as keyof typeof zhCN] === enUS[key as keyof typeof enUS])
      .map(({ key }) => key);
    expect(same).toEqual([]);
  });
});

describe("pointFieldLabelKey：查不到必须回 null（不许印机器码）", () => {
  it("登记过的字段返回对应 key", () => {
    expect(pointFieldLabelKey("education", "courses")).toBe("editor.field.courses");
    expect(pointFieldLabelKey("projects", "tech_stack")).toBe("editor.field.techStack");
    expect(pointFieldLabelKey("campus_experience", "description")).toBe(
      "editor.field.campusDescription",
    );
  });

  it("未登记的要点字段 → null（不是 'bogus'、不是 undefined）", () => {
    expect(pointFieldLabelKey("education", "bogus")).toBeNull();
    expect(pointFieldLabelKey("education", "")).toBeNull();
    expect(pointFieldLabelKey("projects", "courses")).toBeNull();
    // 历史上出现过的机器码字段名，不能被当文案印出来。
    expect(pointFieldLabelKey("projects", "manual_page_break")).toBeNull();
  });

  it("skills / awards 没有要点数组 → 一律 null", () => {
    expect(pointFieldLabelKey("skills", "description")).toBeNull();
    expect(pointFieldLabelKey("awards", "description")).toBeNull();
  });
});

describe("needsPointFieldTags：≥2 个非空要点字段才标", () => {
  it("两个字段 → true；一个字段 / 空条目 / null → false", () => {
    expect(
      needsPointFieldTags({
        points: [
          point({ pointField: "courses", pointId: "ob_c1" }),
          point({ pointField: "achievements", pointId: "ob_a1" }),
        ],
      }),
    ).toBe(true);
    expect(
      needsPointFieldTags({ points: [point({ pointField: "achievements", pointId: "ob_a1" })] }),
    ).toBe(false);
    expect(needsPointFieldTags({ points: [] })).toBe(false);
    expect(needsPointFieldTags(null)).toBe(false);
  });
});

describe("pointFieldGroupLeaders：每组只认第一条", () => {
  it("按扁平顺序取每个字段首次出现的那条", () => {
    const leaders = pointFieldGroupLeaders([
      point({ pointField: "courses", pointId: "ob_c1" }),
      point({ pointField: "achievements", pointId: "ob_a1" }),
      point({ pointField: "achievements", pointId: "ob_a2" }),
      point({ pointField: "achievements", pointId: "ob_a3" }),
    ]);
    expect([...leaders]).toEqual(["ob_c1", "ob_a1"]);
  });

  it("跨字段搬移之后（成果组中间插进一条课程要点）：组首仍是成果一，搬来的那条不是 leader", () => {
    // courses 剩 1 条；achievements = [成果一, 课程一, 成果二, 成果三]
    const leaders = pointFieldGroupLeaders([
      point({ pointField: "courses", pointId: "ob_c2" }),
      point({ pointField: "achievements", pointId: "ob_a1" }),
      point({ pointField: "achievements", pointId: "ob_c1" }),
      point({ pointField: "achievements", pointId: "ob_a2" }),
      point({ pointField: "achievements", pointId: "ob_a3" }),
    ]);
    expect(leaders.has("ob_a1")).toBe(true);
    expect(leaders.has("ob_c1")).toBe(false);
    expect(leaders.has("ob_a2")).toBe(false);
    expect(leaders.has("ob_c2")).toBe(true);
  });

  it("没有 id 的旧要点不会进 leaders（避免把标签挂到空 id 上）", () => {
    const leaders = pointFieldGroupLeaders([
      point({ pointField: "courses", pointId: "" }),
      point({ pointField: "achievements", pointId: "ob_a1" }),
    ]);
    expect([...leaders]).toEqual(["ob_a1"]);
  });
});
