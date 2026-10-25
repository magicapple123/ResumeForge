// SPDX-License-Identifier: Apache-2.0
/** D01 大纲搜索的纯逻辑：命中顺序、祖先保留、大小写、空查询、高亮切分。 */
import { describe, expect, it } from "vitest";
import { ensureIds } from "../resume-document/identity";
import { buildOutline } from "./model";
import { nextMatchIndex, searchOutline, splitHighlight } from "./search";
import type { ResumeContent } from "../../types/resume";
import type { OutlineSection } from "./model";

function makeContent(): ResumeContent {
  return ensureIds({
    photo: "",
    name: "张三",
    gender: "",
    birth_year: "",
    phone: "13800000000",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "",
    summary: "",
    education: [],
    experience: [],
    campus_experience: [],
    projects: [
      {
        name: "支付网关",
        role: "负责人",
        start_date: "",
        end_date: "",
        tech_stack: ["Go"],
        description: ["把结算链路拆成两个服务", "补齐监控告警"],
        highlights: [],
      },
      {
        name: "数据平台",
        role: "开发",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: ["离线报表"],
        highlights: [],
      },
    ],
    skills: [],
    awards: [],
  });
}

const content = makeContent();
const model = buildOutline(content);
const sectionLabel = (section: OutlineSection) =>
  section.field === "projects" ? "项目经历" : (section.titleKey as string);

describe("searchOutline：过滤与命中顺序", () => {
  it("空查询：原模型引用不变、无命中", () => {
    const result = searchOutline(model, content, "   ", { sectionLabel });
    expect(result.query).toBe("");
    expect(result.model).toBe(model);
    expect(result.matches).toEqual([]);
  });

  it("按要点文本命中：只保留命中的要点，条目与板块作为祖先保留", () => {
    const result = searchOutline(model, content, "监控", { sectionLabel });
    expect(result.matchCount).toBe(1);
    const projects = result.model.sections.find((section) => section.field === "projects");
    expect(projects?.entries).toHaveLength(1);
    expect(projects?.entries[0].title).toBe("支付网关");
    expect(projects?.entries[0].points.map((point) => point.text)).toEqual(["补齐监控告警"]);
    // 其它板块被过滤掉（不是保留空壳）。
    expect(result.model.sections.some((section) => section.field === "education")).toBe(false);
  });

  it("按条目标题命中：条目下全部要点都保留（公司名匹配时用户还要看内容）", () => {
    const result = searchOutline(model, content, "数据平台", { sectionLabel });
    const projects = result.model.sections.find((section) => section.field === "projects");
    expect(projects?.entries).toHaveLength(1);
    expect(projects?.entries[0].points).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ kind: "entry" });
  });

  it("按板块标题（界面文案）命中：整个板块的条目都保留", () => {
    const result = searchOutline(model, content, "项目经历", { sectionLabel });
    const projects = result.model.sections.find((section) => section.field === "projects");
    expect(projects?.entries).toHaveLength(2);
  });

  it("按姓名命中个人信息；大小写不敏感", () => {
    const personal = searchOutline(model, content, "张三", { sectionLabel });
    expect(personal.matches[0]?.selection).toEqual({ kind: "personal" });
    const upper = searchOutline(model, content, "GO", { sectionLabel });
    expect(upper.matchCount).toBe(1);
  });

  it("命中顺序 = 树行顺序（条目在它的要点之前）", () => {
    const result = searchOutline(model, content, "支付网关", { sectionLabel });
    expect(result.matches.map((match) => match.kind)).toEqual(["entry"]);
    const both = searchOutline(model, content, "结算", { sectionLabel });
    expect(both.matches.map((match) => match.kind)).toEqual(["point"]);
  });

  it("没有命中：模型为空但不是 null（面板据此显示「没有匹配」）", () => {
    const result = searchOutline(model, content, "不存在的词", { sectionLabel });
    expect(result.matchCount).toBe(0);
    expect(result.model.entryCount).toBe(0);
  });
});

describe("nextMatchIndex / splitHighlight", () => {
  it("循环上下移动；空列表返回 -1", () => {
    expect(nextMatchIndex(-1, 1, 3)).toBe(0);
    expect(nextMatchIndex(2, 1, 3)).toBe(0);
    expect(nextMatchIndex(0, -1, 3)).toBe(2);
    expect(nextMatchIndex(0, 1, 0)).toBe(-1);
  });

  it("高亮切分：大小写不敏感、多段命中、空查询零包装", () => {
    expect(splitHighlight("abcdef", "cd")).toEqual([
      { text: "ab", hit: false },
      { text: "cd", hit: true },
      { text: "ef", hit: false },
    ]);
    expect(splitHighlight("ABCabc", "ab")).toEqual([
      { text: "AB", hit: true },
      { text: "C", hit: false },
      { text: "ab", hit: true },
      { text: "c", hit: false },
    ]);
    expect(splitHighlight("任意", "")).toEqual([{ text: "任意", hit: false }]);
  });
});
