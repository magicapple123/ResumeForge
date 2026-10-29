// SPDX-License-Identifier: Apache-2.0
/**
 * 要点**跨字段搬移**的命令层回归（用户缺陷：教育经历的第一条要点拖不动）。
 *
 * 覆盖四类性质：
 * 1. 文本与 point id **一起**搬：源数组少了这一条、目标数组在目标下标多了一条，id 跟着走；
 * 2. 源字段搬空后保留 `[]`（模板 `{% if %}` 会跳过它，字段不会悄悄消失）；
 * 3. 同字段时与 `reorder-point` **逐字节相同**（一份实现，两套算法不可能分叉）；
 * 4. 拒绝口径与既有 reorder 一致：锁排版 / 身份不全 / 字段不属于该条目族 → 不改内容。
 */
import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../../types/resume";
import { ensureIds } from "../resume-document/identity";
import { applyOutlineCommand } from "./commands";
import { entriesOf, entryIdOf, pointFieldsFor, pointIdsOf } from "./model";
import { buildPathRemap } from "./paths";
import { flatInsertionOf, pointMoveOf } from "./pointMove";
import type { OutlineApplyResult } from "./types";

function content(): ResumeContent {
  return ensureIds({
    photo: "",
    name: "张三",
    gender: "",
    birth_year: "",
    phone: "",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "",
    summary: "",
    education: [
      {
        school: "上海大学",
        major: "市场营销",
        degree: "本科",
        gpa: "",
        start_date: "",
        end_date: "",
        courses: ["市场营销学"],
        achievements: ["奖学金", "竞赛一等奖", "优秀学生"],
      },
    ],
    experience: [],
    campus_experience: [],
    projects: [],
    skills: [],
    awards: [],
  });
}

function educationEntry(source: ResumeContent): Record<string, unknown> {
  return entriesOf(source, "education")[0];
}

function objectId(source: ResumeContent): string {
  return entryIdOf(educationEntry(source));
}

/** 在校成果的文本（`RawEntry` 收窄，测试里只要文本）。 */
function achievementsOf(source: ResumeContent): string[] {
  const value = educationEntry(source).achievements;
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function movedContent(result: OutlineApplyResult): ResumeContent {
  if (!result.ok) throw new Error(result.reason);
  expect(result.changed).toBe(true);
  return result.content;
}

describe("move-point：跨字段搬移", () => {
  it("courses → achievements（目标下标 2）：文本与 point id 一起搬，源字段留在原地", () => {
    const base = content();
    const entry = educationEntry(base);
    const courseId = pointIdsOf(entry, "courses")[0];
    const achievementIds = pointIdsOf(entry, "achievements");
    const result = applyOutlineCommand(base, {
      type: "move-point",
      field: "education",
      objectId: objectId(base),
      fromPointField: "courses",
      toPointField: "achievements",
      pointId: courseId,
      toIndex: 2,
    });
    const next = movedContent(result);
    const nextEntry = educationEntry(next);
    // 内容：课程行变成了目标字段的一条（纸面上就是"课程行 → 项目符号"）。
    expect(nextEntry.achievements).toEqual(["奖学金", "竞赛一等奖", "市场营销学", "优秀学生"]);
    // 源数组搬空后**保留空数组**（模板 `{% if %}` 会跳过它）。
    expect(Array.isArray(nextEntry.courses)).toBe(true);
    expect(nextEntry.courses).toEqual([]);
    // 身份跟着文本走：三个旧 id 的相对顺序不变，被搬的那条 id 落在第 3 位。
    expect(pointIdsOf(nextEntry, "achievements")).toEqual([
      achievementIds[0],
      achievementIds[1],
      courseId,
      achievementIds[2],
    ]);
    expect(pointIdsOf(nextEntry, "courses")).toEqual([]);
    // 入参不可变。
    expect(pointIdsOf(entry, "courses")).toEqual([courseId]);
    expect(entry.courses).toEqual(["市场营销学"]);
  });

  it("搬到目标字段的开头（toIndex 0）与末尾（toIndex = 目标长度）都成立", () => {
    const base = content();
    const courseId = pointIdsOf(educationEntry(base), "courses")[0];
    const head = movedContent(
      applyOutlineCommand(base, {
        type: "move-point",
        field: "education",
        objectId: objectId(base),
        fromPointField: "courses",
        toPointField: "achievements",
        pointId: courseId,
        toIndex: 0,
      }),
    );
    expect(educationEntry(head).achievements).toEqual([
      "市场营销学",
      "奖学金",
      "竞赛一等奖",
      "优秀学生",
    ]);
    const tail = movedContent(
      applyOutlineCommand(base, {
        type: "move-point",
        field: "education",
        objectId: objectId(base),
        fromPointField: "courses",
        toPointField: "achievements",
        pointId: courseId,
        toIndex: 4,
      }),
    );
    expect(educationEntry(tail).achievements).toEqual([
      "奖学金",
      "竞赛一等奖",
      "优秀学生",
      "市场营销学",
    ]);
  });

  it("越界下标一律夹取：99 → 追加末尾，-5 → 开头（拖动/键盘不会算出非法命令）", () => {
    const base = content();
    const courseId = pointIdsOf(educationEntry(base), "courses")[0];
    const over = movedContent(
      applyOutlineCommand(base, {
        type: "move-point",
        field: "education",
        objectId: objectId(base),
        fromPointField: "courses",
        toPointField: "achievements",
        pointId: courseId,
        toIndex: 99,
      }),
    );
    expect(achievementsOf(over)[3]).toBe("市场营销学");
    const under = movedContent(
      applyOutlineCommand(base, {
        type: "move-point",
        field: "education",
        objectId: objectId(base),
        fromPointField: "courses",
        toPointField: "achievements",
        pointId: courseId,
        toIndex: -5,
      }),
    );
    expect(achievementsOf(under)[0]).toBe("市场营销学");
  });

  it("目标字段为空时照样能搬（长度 0 = 0，身份完整性天然成立）", () => {
    const base = content();
    const entry = educationEntry(base);
    const achievementId = pointIdsOf(entry, "achievements")[0];
    const result = applyOutlineCommand(base, {
      type: "move-point",
      field: "education",
      objectId: objectId(base),
      fromPointField: "achievements",
      toPointField: "courses",
      pointId: achievementId,
      toIndex: 0,
    });
    const nextEntry = educationEntry(movedContent(result));
    expect(nextEntry.courses).toEqual(["奖学金", "市场营销学"]);
    expect(nextEntry.achievements).toEqual(["竞赛一等奖", "优秀学生"]);
    expect(pointIdsOf(nextEntry, "courses")[0]).toBe(achievementId);
  });
});

describe("move-point：同字段 = reorder-point（一份实现）", () => {
  it("同字段两条命令产出的内容逐字段相同（不存在第二套重排算法）", () => {
    const base = content();
    const entry = educationEntry(base);
    const moveId = pointIdsOf(entry, "achievements")[2];
    const viaMove = movedContent(
      applyOutlineCommand(base, {
        type: "move-point",
        field: "education",
        objectId: objectId(base),
        fromPointField: "achievements",
        toPointField: "achievements",
        pointId: moveId,
        toIndex: 0,
      }),
    );
    const viaReorder = movedContent(
      applyOutlineCommand(base, {
        type: "reorder-point",
        field: "education",
        objectId: objectId(base),
        pointField: "achievements",
        pointId: moveId,
        toIndex: 0,
      }),
    );
    expect(viaMove).toEqual(viaReorder);
    expect(educationEntry(viaMove).achievements).toEqual(["优秀学生", "奖学金", "竞赛一等奖"]);
    // 另一个字段一条都不动。
    expect(educationEntry(viaMove).courses).toEqual(["市场营销学"]);
    expect(pointIdsOf(educationEntry(viaMove), "achievements")).toEqual([
      moveId,
      pointIdsOf(entry, "achievements")[0],
      pointIdsOf(entry, "achievements")[1],
    ]);
  });

  it("同字段原地（toIndex = 当前下标）→ changed=false，内容引用不变", () => {
    const base = content();
    const result = applyOutlineCommand(base, {
      type: "move-point",
      field: "education",
      objectId: objectId(base),
      fromPointField: "achievements",
      toPointField: "achievements",
      pointId: pointIdsOf(educationEntry(base), "achievements")[1],
      toIndex: 1,
    });
    expect(result).toEqual({ ok: true, content: base, changed: false });
  });
});

describe("move-point：拒绝口径与既有 reorder 同一套", () => {
  it("锁排版 → locked-layout，内容不改", () => {
    const base = content();
    const entry = educationEntry(base);
    const locked = {
      ...base,
      education: [{ ...entry, lock_layout: true }],
    } as unknown as ResumeContent;
    const result = applyOutlineCommand(locked, {
      type: "move-point",
      field: "education",
      objectId: objectId(base),
      fromPointField: "courses",
      toPointField: "achievements",
      pointId: pointIdsOf(entry, "courses")[0],
      toIndex: 0,
    });
    expect(result).toEqual({ ok: false, reason: "locked-layout" });
  });

  it("身份不全（旧记录没物化 point_ids）→ not-found", () => {
    const base = content();
    const entry = educationEntry(base);
    const withoutIds = { ...entry };
    delete (withoutIds as Record<string, unknown>).point_ids;
    const broken = { ...base, education: [withoutIds] } as unknown as ResumeContent;
    const result = applyOutlineCommand(broken, {
      type: "move-point",
      field: "education",
      objectId: objectId(base),
      fromPointField: "courses",
      toPointField: "achievements",
      pointId: pointIdsOf(entry, "courses")[0],
      toIndex: 0,
    });
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  it("目标字段不属于该条目族 / 要点不存在 / 条目不存在 → not-found", () => {
    const base = content();
    const courseId = pointIdsOf(educationEntry(base), "courses")[0];
    const base62 = {
      type: "move-point" as const,
      field: "education" as const,
      objectId: objectId(base),
      fromPointField: "courses",
      toPointField: "highlights",
      pointId: courseId,
      toIndex: 0,
    };
    expect(applyOutlineCommand(base, base62)).toEqual({ ok: false, reason: "not-found" });
    expect(
      applyOutlineCommand(base, {
        ...base62,
        toPointField: "achievements",
        pointId: "ob_000000000000",
      }),
    ).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(
      applyOutlineCommand(base, {
        ...base62,
        objectId: "ob_000000000000",
        toPointField: "achievements",
      }),
    ).toEqual({ ok: false, reason: "not-found" });
    // 没有要点字段的条目族（skills）不接受任何搬移。
    expect(
      applyOutlineCommand(base, {
        ...base62,
        field: "skills",
        fromPointField: "description",
        toPointField: "description",
      }),
    ).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("搬移后仍满足后端保存契约（validate_document_ids）", () => {
  /** 后端 `document_identity.validate_document_ids` 的三条硬规则（前端必须同时满足）。 */
  function expectSaveContract(content: ResumeContent, field: "education" | "projects"): void {
    const entry = entriesOf(content, field)[0] as Record<string, unknown>;
    const ids = (entry.point_ids ?? {}) as Record<string, string[]>;
    const declared = pointFieldsFor(field);
    // ① key 只允许该条目模型声明的字段（别为"记住原来是哪类"另造 moved_from 之类）。
    for (const key of Object.keys(ids)) expect(declared).toContain(key);
    for (const pointField of declared) {
      const values = entry[pointField];
      const list = Array.isArray(values) ? values.length : 0;
      // ② point_ids[key].length === entry[key].length（0 == 0 合法，所以空数组可以留）。
      expect(ids[pointField]?.length ?? 0).toBe(list);
      // ③ 同一数组内 id 唯一。
      const arrayIds = ids[pointField] ?? [];
      expect(new Set(arrayIds).size).toBe(arrayIds.length);
    }
  }

  it("跨字段搬移后：两数组与两份 id 列表同步、无多余 key、id 不重复", () => {
    const base = content();
    expectSaveContract(base, "education");
    const courseId = pointIdsOf(educationEntry(base), "courses")[0];
    const applied = applyOutlineCommand(base, {
      type: "move-point",
      field: "education",
      objectId: objectId(base),
      fromPointField: "courses",
      toPointField: "achievements",
      pointId: courseId,
      toIndex: 1,
    });
    if (!applied.ok) throw new Error(applied.reason);
    expectSaveContract(applied.content, "education");
    const nextEntry = educationEntry(applied.content);
    expect((nextEntry.point_ids as Record<string, string[]>).courses).toEqual([]);
    expect((nextEntry.point_ids as Record<string, string[]>).achievements).toHaveLength(4);
    // 被搬的 id 只出现一次（没有"复制一份再删源"的中间态）。
    const allIds = Object.values(nextEntry.point_ids as Record<string, string[]>).flat();
    expect(allIds.filter((pointId) => pointId === courseId)).toHaveLength(1);
  });

  it("同字段重排后同样满足契约（length 与唯一性都不破）", () => {
    const base = content();
    const applied = applyOutlineCommand(base, {
      type: "reorder-point",
      field: "education",
      objectId: objectId(base),
      pointField: "achievements",
      pointId: pointIdsOf(educationEntry(base), "achievements")[0],
      toIndex: 2,
    });
    if (!applied.ok) throw new Error(applied.reason);
    expectSaveContract(applied.content, "education");
  });
});

describe("搬移后路径重映射：加粗/来源标注跟着这一条走", () => {
  it("旧路径 education.0.courses.0 → 新路径 education.0.achievements.2（换了字段也不算丢）", () => {
    const base = content();
    const courseId = pointIdsOf(educationEntry(base), "courses")[0];
    const applied = applyOutlineCommand(base, {
      type: "move-point",
      field: "education",
      objectId: objectId(base),
      fromPointField: "courses",
      toPointField: "achievements",
      pointId: courseId,
      toIndex: 2,
    });
    if (!applied.ok) throw new Error(applied.reason);
    const remap = buildPathRemap(base, applied.content);
    expect(remap.get("education.0.courses.0")).toBe("education.0.achievements.2");
    // 没动的那几条成果仍然按 id 对齐到新下标（被搬进来的那条把它们往后挤了）。
    expect(remap.get("education.0.achievements.0")).toBe("education.0.achievements.0");
    expect(remap.get("education.0.achievements.2")).toBe("education.0.achievements.3");
  });
});

describe("扁平下标 → (字段, 组内下标) 的推导", () => {
  const flat = [
    { pointField: "courses", pointId: "c0" },
    { pointField: "achievements", pointId: "a0" },
    { pointField: "achievements", pointId: "a1" },
    { pointField: "achievements", pointId: "a2" },
  ];

  it("拖到第 3 条（扁平下标 2）→ 落在 achievements 的第 3 位（下标 2）", () => {
    expect(flatInsertionOf(flat, 0, 2)).toEqual({
      targetField: "achievements",
      fieldIndex: 2,
      flatIndex: 2,
    });
  });

  it("拖到最后一行的位置 → 落到该字段的末尾（不会掉出字段之外）", () => {
    expect(flatInsertionOf(flat, 0, 3)).toEqual({
      targetField: "achievements",
      fieldIndex: 3,
      flatIndex: 3,
    });
    // 最后一条拖到最前：成为 courses 的第 1 条。
    expect(flatInsertionOf(flat, 3, 0)).toEqual({
      targetField: "courses",
      fieldIndex: 0,
      flatIndex: 0,
    });
  });

  it("会话 → 命令字段：按 id 定位源，跨字段时 sameField=false", () => {
    expect(
      pointMoveOf(flat, {
        pointField: "courses",
        pointId: "c0",
        startIndex: 0,
        currentIndex: 2,
      }),
    ).toEqual({
      fromPointField: "courses",
      toPointField: "achievements",
      toIndex: 2,
      sameField: false,
    });
    // 同字段上移一格：目标仍是 achievements，组内下标 0。
    expect(
      pointMoveOf(flat, {
        pointField: "achievements",
        pointId: "a2",
        startIndex: 3,
        currentIndex: 1,
      }),
    ).toEqual({
      fromPointField: "achievements",
      toPointField: "achievements",
      toIndex: 0,
      sameField: true,
    });
  });

  it("只有一条要点时推不出落点（移动它什么都变不了）", () => {
    expect(flatInsertionOf([{ pointField: "courses", pointId: "c0" }], 0, 0)).toBeNull();
    expect(flatInsertionOf(flat, 9, 0)).toBeNull();
  });
});
