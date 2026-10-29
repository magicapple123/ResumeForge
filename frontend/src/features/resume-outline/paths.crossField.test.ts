// SPDX-License-Identifier: Apache-2.0
/**
 * `buildPathRemap` 的**跨字段**映射（QA 独立取证，补充 `paths.test.ts`）。
 *
 * ## 为什么必须单独钉住
 *
 * 加粗 overlay / 事实标注 / 局部排版的键是**下标路径**（`education.0.courses.0`）。
 * 本次改动允许要点跨字段搬移（`courses` → `achievements`），要点 id 换了数组——如果
 * `buildPathRemap` 仍然"只在同一个 pointField 里按位置对齐"，那条要点的旧键就会被留在一个
 * **已经不存在**的路径上（`education.0.courses.0` 在搬空之后什么都不指），用户在课程行
 * 上加的粗体会静默消失（或者更糟：绑到下一轮写进 `courses` 的别的要点上）。
 *
 * 这里用**真实的命令产出**（`applyOutlineCommand` → `move-point`）当 `after`，而不是手工
 * 编一份"看起来对"的内容：被测的正是"命令层 + 映射层"这条真实链路。
 */
import { describe, expect, it } from "vitest";
import { ensureIds } from "../resume-document/identity";
import { applyOutlineCommand } from "./commands";
import { entriesOf, entryIdOf, pointIdsOf } from "./model";
import { buildPathRemap, remapAnnotationPaths, remapPathMap } from "./paths";
import type { ResumeContent } from "../../types/resume";

function baseContent(): ResumeContent {
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
        school: "学校甲",
        major: "计算机",
        degree: "本科",
        start_date: "2020-09",
        end_date: "2024-06",
        gpa: "3.8",
        courses: ["数据结构"],
        achievements: ["成果一", "成果二", "成果三"],
      },
    ],
    experience: [],
    campus_experience: [],
    projects: [
      {
        name: "项目甲",
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: ["要点一", "要点二", "要点三"],
        highlights: [],
      },
    ],
    skills: [],
    awards: [],
  });
}

function educationOf(content: ResumeContent) {
  return entriesOf(content, "education")[0];
}

/** 教育经历里唯一那条课程要点的 id。 */
function coursePointId(content: ResumeContent): string {
  return pointIdsOf(educationOf(content), "courses")[0];
}

/** 走真实命令：把课程要点搬进 `achievements` 的下标 `toIndex`。 */
function moveCourseToAchievements(content: ResumeContent, toIndex: number): ResumeContent {
  const entry = educationOf(content);
  const result = applyOutlineCommand(content, {
    type: "move-point",
    field: "education",
    objectId: entryIdOf(entry),
    fromPointField: "courses",
    toPointField: "achievements",
    pointId: coursePointId(content),
    toIndex,
  });
  if (!result.ok) throw new Error(`命令被拒绝：${result.reason}`);
  return result.content;
}

describe("buildPathRemap：跨字段搬移后旧键要跟到新位置", () => {
  it("education.0.courses.0 → education.0.achievements.<新下标>（不是留在课程的旧路径上）", () => {
    const before = baseContent();
    // 搬到 achievements 下标 2：成果一 / 成果二 / 课程要点 / 成果三
    const after = moveCourseToAchievements(before, 2);
    expect(educationOf(after).achievements).toEqual(["成果一", "成果二", "数据结构", "成果三"]);
    expect(educationOf(after).courses).toEqual([]);

    const remap = buildPathRemap(before, after);
    expect(remap.get("education.0.courses.0")).toBe("education.0.achievements.2");
  });

  it("同条目内其余要点按 id 各自对齐（成果三从 2 挪到 3，成果一/二不变）", () => {
    const before = baseContent();
    const after = moveCourseToAchievements(before, 2);
    const remap = buildPathRemap(before, after);
    expect(remap.get("education.0.achievements.0")).toBe("education.0.achievements.0");
    expect(remap.get("education.0.achievements.1")).toBe("education.0.achievements.1");
    expect(remap.get("education.0.achievements.2")).toBe("education.0.achievements.3");
  });

  it("搬到目标数组开头（下标 0）时映射同样成立", () => {
    const before = baseContent();
    const after = moveCourseToAchievements(before, 0);
    expect(educationOf(after).achievements).toEqual(["数据结构", "成果一", "成果二", "成果三"]);
    const remap = buildPathRemap(before, after);
    expect(remap.get("education.0.courses.0")).toBe("education.0.achievements.0");
    expect(remap.get("education.0.achievements.0")).toBe("education.0.achievements.1");
  });

  it("搬到目标数组末尾（下标 = 长度）时映射同样成立", () => {
    const before = baseContent();
    const after = moveCourseToAchievements(before, 3);
    expect(educationOf(after).achievements).toEqual(["成果一", "成果二", "成果三", "数据结构"]);
    const remap = buildPathRemap(before, after);
    expect(remap.get("education.0.courses.0")).toBe("education.0.achievements.3");
  });

  it("映射直接改键：加粗 overlay 的旧键搬到新路径，值不丢", () => {
    const before = baseContent();
    const after = moveCourseToAchievements(before, 2);
    const remap = buildPathRemap(before, after);
    const overrides = {
      "education.0.courses.0": { kind: "bold" },
      "education.0.school": { kind: "italic" },
    } as Record<string, { kind: string }>;
    const moved = remapPathMap(overrides, remap);
    expect(moved["education.0.achievements.2"]).toEqual({ kind: "bold" });
    expect(moved["education.0.courses.0"]).toBeUndefined();
    // 无关的标量键照旧跟着条目走。
    expect(moved["education.0.school"]).toEqual({ kind: "italic" });
  });

  it("事实标注（带 path 的数组）同样跟着走", () => {
    const before = baseContent();
    const after = moveCourseToAchievements(before, 1);
    const remap = buildPathRemap(before, after);
    const items = [{ path: "education.0.courses.0", text: "课程来源" }];
    expect(remapAnnotationPaths(items, remap)).toEqual([
      { path: "education.0.achievements.1", text: "课程来源" },
    ]);
  });
});

describe("buildPathRemap：同字段重排的旧行为不能变", () => {
  it("projects.0.description 内部重排：每个要点按 id 跟到新下标", () => {
    const before = baseContent();
    const project = entriesOf(before, "projects")[0];
    const movedId = pointIdsOf(project, "description")[0];
    const result = applyOutlineCommand(before, {
      type: "reorder-point",
      field: "projects",
      objectId: entryIdOf(project),
      pointField: "description",
      pointId: movedId,
      toIndex: 2,
    });
    if (!result.ok) throw new Error("命令被拒绝");
    const after = result.content;
    expect(entriesOf(after, "projects")[0].description).toEqual(["要点二", "要点三", "要点一"]);

    const remap = buildPathRemap(before, after);
    // 要点一：0 → 2；要点二：1 → 0；要点三：2 → 1
    expect(remap.get("projects.0.description.0")).toBe("projects.0.description.2");
    expect(remap.get("projects.0.description.1")).toBe("projects.0.description.0");
    expect(remap.get("projects.0.description.2")).toBe("projects.0.description.1");
  });

  it("条目级重排：标量字段与要点路径都按 id 跟到新条目下标", () => {
    const before = ensureIds({
      ...baseContent(),
      projects: [
        {
          name: "甲",
          role: "",
          start_date: "",
          end_date: "",
          tech_stack: [],
          description: ["甲-1"],
          highlights: [],
        },
        {
          name: "乙",
          role: "",
          start_date: "",
          end_date: "",
          tech_stack: [],
          description: ["乙-1"],
          highlights: [],
        },
      ],
    }) as ResumeContent;
    const first = entriesOf(before, "projects")[0];
    const result = applyOutlineCommand(before, {
      type: "reorder-entry",
      field: "projects",
      objectId: entryIdOf(first),
      toIndex: 1,
    });
    if (!result.ok) throw new Error("命令被拒绝");
    const remap = buildPathRemap(before, result.content);
    expect(remap.get("projects.0.name")).toBe("projects.1.name");
    expect(remap.get("projects.0.description.0")).toBe("projects.1.description.0");
    expect(remap.get("projects.1.name")).toBe("projects.0.name");
    expect(remap.get("projects.1.description.0")).toBe("projects.0.description.0");
  });

  it("命令没改动内容时映射是恒等（拖动 no-op 不会把 overlay 挪走）", () => {
    const before = baseContent();
    const remap = buildPathRemap(before, before);
    expect(remap.get("education.0.courses.0")).toBe("education.0.courses.0");
    expect(remap.get("education.0.achievements.2")).toBe("education.0.achievements.2");
  });
});
