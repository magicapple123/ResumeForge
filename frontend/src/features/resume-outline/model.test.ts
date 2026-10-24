// SPDX-License-Identifier: Apache-2.0
/**
 * 只读大纲树与"路径 → 选择"的纯函数测试。重点：
 * - 树的结构/标题/次行来自内容本身（用户数据不进 i18n）；
 * - `selectionFromPath` 能把纸面点击的 `data-resume-path` 翻成 id 锚定的选择；
 * - 旧记录没物化 id 时降级为不可操作，而不是拿数组下标冒充身份。
 */
import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../../types/resume";
import { ensureIds } from "../resume-document/identity";
import {
  buildOutline,
  entryKey,
  findOutlineEntry,
  findOutlinePoint,
  personalSubtitle,
  selectionFromPath,
  selectionKey,
} from "./model";

function content(): ResumeContent {
  return {
    photo: "data:image/png;base64,AAAA",
    name: "张三",
    gender: "",
    birth_year: "",
    phone: "13800000000",
    email: "zhang@example.com",
    city: "上海",
    personal_website: "",
    github: "",
    job_intent: "后端开发",
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
        start_date: "2022-07",
        end_date: "",
        description: ["做了甲"],
      },
    ],
    campus_experience: [
      {
        organization: "学生会",
        role: "部长",
        start_date: "",
        end_date: "",
        description: ["组织活动"],
      },
    ],
    projects: [
      {
        name: "项目乙",
        role: "开发",
        start_date: "",
        end_date: "",
        tech_stack: ["TypeScript"],
        description: ["做了乙一", "做了乙二"],
        highlights: ["获奖了"],
      },
    ],
    skills: [{ name: "Python", level: "熟练" }],
    awards: [{ name: "一等奖", date: "2021", description: "校级" }],
  };
}

describe("buildOutline", () => {
  it("七个分组按固定顺序出现，计数覆盖条目与要点", () => {
    const model = buildOutline(ensureIds(content()));
    expect(model.sections.map((section) => section.key)).toEqual([
      "personal",
      "education",
      "experience",
      "campus_experience",
      "projects",
      "skills",
      "awards",
    ]);
    // 个人信息没有条目数组，但分组必须在。
    expect(model.sections[0].entries).toEqual([]);
    expect(model.entryCount).toBe(6);
    // 教育 2 + 工作 1 + 校园 1 + 项目 4（技术栈 1 + 描述 2 + 亮点 1）+ 技能 0 + 获奖 0。
    expect(model.pointCount).toBe(8);
  });

  it("标题/次行/要点顺序来自内容：用户数据原样，日期区间缺失一端时不补", () => {
    const model = buildOutline(ensureIds(content()));
    const education = model.sections.find((section) => section.key === "education")?.entries[0];
    expect(education?.title).toBe("示例大学");
    expect(education?.subtitle).toBe("软件工程 · 本科 · 2018-09 - 2022-06");
    const experience = model.sections.find((section) => section.key === "experience")?.entries[0];
    // 结束日期为空：只显示开始日期，不出现 "2022-07 - "。
    expect(experience?.subtitle).toBe("工程师 · 2022-07");
    const project = model.sections.find((section) => section.key === "projects")?.entries[0];
    expect(project?.points.map((point) => point.pointField)).toEqual([
      "tech_stack",
      "description",
      "description",
      "highlights",
    ]);
    expect(project?.points.map((point) => point.text)).toEqual([
      "TypeScript",
      "做了乙一",
      "做了乙二",
      "获奖了",
    ]);
    // 每个要点都有稳定 id（W01 物化后）。
    for (const point of project?.points ?? []) expect(point.pointId).not.toBe("");
  });

  it("旧记录没有 id 时 objectId 为空串（界面降级为只读，不拿下标冒充身份）", () => {
    const legacy = buildOutline(content());
    expect(legacy.sections[1].entries[0].objectId).toBe("");
    // 面板边界会先 ensureIds；补齐后 id 出现。
    expect(buildOutline(ensureIds(content())).sections[1].entries[0].objectId).toMatch(/^ob_/);
  });

  it("隐藏/锁定标志读成布尔，缺失一律 false", () => {
    const flagged = ensureIds(content());
    const withFlags: ResumeContent = {
      ...flagged,
      experience: [{ ...flagged.experience[0], hidden: true, lock_content: true }],
    };
    const entry = buildOutline(withFlags).sections.find((section) => section.key === "experience")
      ?.entries[0];
    expect(entry).toMatchObject({ hidden: true, lockContent: true, lockLayout: false });
  });
});

describe("selectionFromPath", () => {
  const ready = ensureIds(content());

  it("个人信息标量路径 → personal 选择", () => {
    expect(selectionFromPath(ready, "summary")).toEqual({ kind: "personal" });
    expect(selectionFromPath(ready, "email")).toEqual({ kind: "personal" });
    // 带后续下标也仍是个人信息（photo 等非文本字段不产生路径，但不应崩）。
    expect(selectionFromPath(ready, "name")).toEqual({ kind: "personal" });
  });

  it("条目标量字段 → 条目选择；要点路径 → 要点选择（id 来自 point_ids）", () => {
    const projectId = ready.projects[0].id as string;
    expect(selectionFromPath(ready, "projects.0.name")).toEqual({
      kind: "entry",
      field: "projects",
      objectId: projectId,
    });
    const pointIds = ready.projects[0].point_ids?.description ?? [];
    expect(selectionFromPath(ready, "projects.0.description.1")).toEqual({
      kind: "point",
      field: "projects",
      objectId: projectId,
      pointField: "description",
      pointId: pointIds[1],
    });
  });

  it("未知/越界路径返回 null（纸面点到旧内容时不静默选中别人）", () => {
    expect(selectionFromPath(ready, "projects.9.name")).toBeNull();
    expect(selectionFromPath(ready, "unknown_field")).toBeNull();
    expect(selectionFromPath(ready, "")).toBeNull();
    expect(selectionFromPath(ready, "projects.not-a-number.name")).toBeNull();
  });
});

describe("选择键与模型查找", () => {
  it("同一对象只有一种键；模型能找回条目与要点", () => {
    const ready = ensureIds(content());
    const model = buildOutline(ready);
    const projectId = ready.projects[0].id as string;
    const entrySelection = { kind: "entry", field: "projects", objectId: projectId } as const;
    expect(selectionKey(entrySelection)).toBe(entryKey("projects", projectId));
    expect(findOutlineEntry(model, entrySelection)?.title).toBe("项目乙");

    const pointId = ready.projects[0].point_ids?.description?.[1] as string;
    const pointSelection = {
      kind: "point",
      field: "projects",
      objectId: projectId,
      pointField: "description",
      pointId,
    } as const;
    expect(selectionKey(pointSelection)).toBe(`point:projects:${projectId}:description:${pointId}`);
    expect(findOutlinePoint(model, pointSelection)?.text).toBe("做了乙二");
    expect(findOutlineEntry(model, null)).toBeNull();
  });

  it("陈旧选择（id 已不在内容里）返回 null，不误指同下标的新条目", () => {
    const ready = ensureIds(content());
    const model = buildOutline(ready);
    expect(
      findOutlineEntry(model, { kind: "entry", field: "projects", objectId: "ob_000000000000" }),
    ).toBeNull();
  });
});

describe("personalSubtitle", () => {
  it("只拼已有联系方式，不把空字段连成一串分隔符", () => {
    expect(personalSubtitle(content())).toBe("13800000000 · zhang@example.com · 上海");
    expect(personalSubtitle({ ...content(), phone: "", email: "", city: "" })).toBe("");
    expect(personalSubtitle(null)).toBe("");
  });
});
