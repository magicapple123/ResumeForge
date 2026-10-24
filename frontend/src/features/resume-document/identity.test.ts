// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";

import type { ResumeContent } from "../../types/resume";
import {
  cloneEntryWithNewIds,
  ensureIds,
  isObjectId,
  newObjectId,
  reorderPreservingIds,
  resolvePathAt,
} from "./identity";
import { OBJECT_ID_PATTERN } from "./identity";

function content(): ResumeContent {
  return {
    photo: "",
    name: "张三",
    gender: "",
    birth_year: "",
    phone: "13800000000",
    email: "zhang@example.com",
    city: "上海",
    personal_website: "",
    github: "",
    job_intent: "后端",
    summary: "一段总结",
    education: [
      {
        school: "示例大学",
        major: "软件工程",
        degree: "本科",
        start_date: "2018-09",
        end_date: "2022-06",
        gpa: "3.8",
        courses: ["数据结构"],
        achievements: ["奖学金"],
      },
    ],
    experience: [
      {
        company: "甲公司",
        role: "工程师",
        start_date: "",
        end_date: "",
        description: ["做了甲", "做了乙"],
      },
      { company: "乙公司", role: "工程师", start_date: "", end_date: "", description: ["做了丙"] },
    ],
    campus_experience: [],
    projects: [
      {
        name: "项目甲",
        role: "负责人",
        start_date: "",
        end_date: "",
        tech_stack: ["Python"],
        description: ["做了甲"],
        highlights: ["上线了"],
      },
    ],
    skills: [{ name: "Python", level: "熟练" }],
    awards: [{ name: "一等奖", date: "2021", description: "" }],
  };
}

describe("newObjectId", () => {
  it("符合后端校验口径且 1000 次不重复", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 1000; index += 1) {
      const value = newObjectId();
      expect(value).toMatch(OBJECT_ID_PATTERN);
      expect(isObjectId(value)).toBe(true);
      seen.add(value);
    }
    expect(seen.size).toBe(1000);
  });
});

describe("ensureIds", () => {
  it("补齐条目与要点 id，且不改动其它字段", () => {
    const source = content();
    const next = ensureIds(source);

    expect(next.experience[0].id).toMatch(OBJECT_ID_PATTERN);
    expect(next.experience[0].point_ids?.description).toHaveLength(2);
    expect(next.projects[0].point_ids?.tech_stack).toHaveLength(1);
    expect(next.skills[0].id).toMatch(OBJECT_ID_PATTERN);
    expect(next.awards[0].id).toMatch(OBJECT_ID_PATTERN);
    // 没有要点数组的条目不该凭空长出 point_ids。
    expect(next.skills[0]).not.toHaveProperty("point_ids");
    // 内容一字不动。
    expect(next.experience[0].company).toBe("甲公司");
    expect(next.experience[0].description).toEqual(["做了甲", "做了乙"]);
    // 入参不被就地改写。
    expect(source.experience[0].id).toBeUndefined();
  });

  it("幂等：连续两次调用结果一致（保存一次不换一次 id）", () => {
    const once = ensureIds(content());
    const twice = ensureIds(once);
    expect(twice).toEqual(once);
  });

  it("要点增删后整组重建，不把新要点挂到旧身份上", () => {
    const withIds = ensureIds(content());
    const changed = {
      ...withIds,
      experience: [{ ...withIds.experience[0], description: ["只剩一条"] }, withIds.experience[1]],
    };
    const next = ensureIds(changed);
    const ids = next.experience[0].point_ids?.description ?? [];
    expect(ids).toHaveLength(1);
    // 条目 id 本身保留：条目还是那一条经历，只是要点变了。
    expect(next.experience[0].id).toBe(withIds.experience[0].id);
  });
});

describe("resolvePathAt", () => {
  it("排序后按 id 现算新下标", () => {
    const withIds = ensureIds(content());
    const secondId = withIds.experience[1].id as string;
    expect(resolvePathAt(withIds, secondId)).toBe("experience.1");

    const moved = {
      ...withIds,
      experience: reorderPreservingIds(withIds.experience, 1, 0),
    };
    expect(moved.experience[0].id).toBe(secondId);
    expect(resolvePathAt(moved, secondId)).toBe("experience.0");
  });

  it("非法或未知 id 返回 null", () => {
    expect(resolvePathAt(content(), "not an id")).toBeNull();
    expect(resolvePathAt(content(), "ob_000000000000")).toBeNull();
  });
});

describe("cloneEntryWithNewIds", () => {
  it("复制后身份全新、内容相同", () => {
    const source = ensureIds(content()).experience[0];
    const copy = cloneEntryWithNewIds(source, "experience");
    expect(copy.company).toBe(source.company);
    expect(copy.description).toEqual(source.description);
    expect(copy.id).not.toBe(source.id);
    expect(copy.point_ids?.description).not.toEqual(source.point_ids?.description);
  });
});
