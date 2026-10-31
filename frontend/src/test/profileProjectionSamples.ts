// SPDX-License-Identifier: Apache-2.0
/**
 * 投影夹具的样例数据（F8 小字段 / 13 分区全参与）。
 *
 * 与 profileProjectionFixture.ts 拆开只为一个原因：那个文件要同时装"空投影 / 按 content
 * 构造 / 旧 Profile 兼容层"，已贴 500 行预算；样例只被少量用例引用，独立成文件后两份都有余量。
 */
import type { PaperProjectionOut } from "../features/profile-library/types";
import { projectionOf } from "./profileProjectionFixture";

/** F8（R-81）投影夹具：content 条目带资料小字段的新可选属性（导师/研究方向/成绩排名等）。 */
export function projectionWithF8Fields(): PaperProjectionOut {
  return projectionOf({
    keys: [
      "basic_info",
      "educations",
      "experiences",
      "campus_experiences",
      "projects",
      "skills",
      "awards",
      "summary",
    ],
    groupName: "F8 组",
    content: {
      name: "张三",
      job_intent: "前端开发",
      summary: "个人总结",
      education: [
        {
          school: "示例大学",
          major: "软件工程",
          degree: "本科",
          start_date: "2023.09",
          end_date: "2027.06",
          gpa: "3.8",
          courses: [],
          achievements: [],
          study_form: "全日制",
          degree_type: "学术学位",
          department: "计算机学院",
          rank: "前 10%",
          advisor: "张伟",
          research_direction: "联邦学习",
        },
      ],
      experience: [
        {
          company: "示例科技",
          role: "前端实习生",
          start_date: "2025.03",
          end_date: "2025.08",
          description: ["负责组件库"],
          team_size: "8 人",
          experience_kind: "internship",
        },
      ],
      campus_experience: [],
      projects: [
        {
          name: "ResumeForge",
          role: "负责人",
          start_date: "2026.01",
          end_date: "2026.06",
          tech_stack: [],
          description: [],
          highlights: [],
          project_size: "10 人",
          artifact_type: "开源项目",
        },
      ],
      skills: [{ name: "TypeScript", level: "熟练", category: "编程语言" }],
      awards: [
        {
          name: "一等奖学金",
          date: "2024.10",
          description: "",
          issuer: "示例大学",
          level: "校级",
          ratio: "前 5%",
        },
      ],
    },
  });
}

/** 13 个系统分区全参与、但只有 content 内容的投影（F4-C：7 组 / 13 组对比用）。 */
export function projectionWithThirteenSections(): PaperProjectionOut {
  return projectionOf({
    content: {
      name: "张三",
      job_intent: "前端开发",
      summary: "资料里的个人总结",
      education: [
        {
          school: "示例大学",
          major: "软件工程",
          degree: "本科",
          start_date: "2023.09",
          end_date: "2027.06",
          gpa: "",
          courses: [],
          achievements: [],
        },
      ],
      experience: [
        {
          company: "示例科技",
          role: "前端实习生",
          start_date: "2025.03",
          end_date: "2025.08",
          description: [],
        },
      ],
      campus_experience: [],
      projects: [],
      skills: [{ name: "TypeScript", level: "熟练" }],
      awards: [],
    },
    keys: [
      "basic_info",
      "educations",
      "experiences",
      "campus_experiences",
      "projects",
      "skills",
      "awards",
      "summary",
      "languages",
      "publications",
      "research_projects",
      "patents",
      "credentials",
    ],
    groupName: "全量组",
  });
}
