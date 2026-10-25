// SPDX-License-Identifier: Apache-2.0
/**
 * 「从我的资料填入」候选的纯函数测试。
 *
 * 这里盯的是两件不写用例就会错的事：
 * 1. **形状**：候选的 `value` 必须与简历编辑器里的表单值逐字相同——否则填进去的那一条
 *    在表单里显示不出来（字段名对不上），而界面上只会表现为"点了填入，什么都没发生"；
 * 2. **去重键**：同一条经历在资料里出现两次（或用户改了分数但没改学校）时，下拉里只该
 *    有一条。重复的教育/项目是打印出来才看得见的那类问题。
 */

import { describe, expect, it } from "vitest";
import type { Profile } from "../../types";
import { legacyProfileToProjection } from "../../test/profileProjectionFixture";
import {
  awardFillKey,
  buildProfileFillSources,
  campusExperienceFillKey,
  educationFillKey,
  experienceFillKey,
  projectFillKey,
  skillFillKey,
} from "./profileFillOptions";

/** 旧资料夹具 → 投影（测试兼容层）：被测函数输入是服务端投影（F4 §5.4）。 */
function sourcesOf(profile: Profile) {
  return buildProfileFillSources(legacyProfileToProjection(profile));
}

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 1,
    photo: "",
    name: "张三",
    gender: "",
    birth_year: "",
    phone: "",
    email: "",
    city: "",
    target_city: "",
    job_intent: "",
    personal_website: "",
    github: "",
    summary: "  三年后端开发经验，熟悉 Python。  ",
    wechat: "",
    birth_date: "",
    id_type: "",
    id_number: "",
    country_region: "",
    native_place: "",
    political_status: "",
    phone_country_code: "+86",
    family_info: "",
    expected_salary: "",
    qq: "",
    advisor: "",
    research_direction: "",
    preferred_industry: "",
    section_order: [],
    educations: [],
    experiences: [],
    campus_experiences: [],
    projects: [],
    skills: [],
    awards: [],
    ...overrides,
  };
}

/** 资料里的一条教育经历（`Education` 的必填字段都给上）。 */
function education(overrides: Record<string, string> = {}) {
  return {
    school: "示例大学",
    department: "",
    major: "软件工程",
    degree: "本科",
    study_mode: "",
    degree_type: "",
    start_date: "2023.09",
    end_date: "2027.06",
    gpa: "3.8",
    cet4_score: "",
    cet6_score: "",
    courses: "数据结构\n操作系统",
    achievements: "校级奖学金",
    ...overrides,
  };
}

describe("buildProfileFillSources", () => {
  it("六个模块都从资料映射出来，value 的形状与表单一致", () => {
    const sources = sourcesOf(
      profile({
        educations: [education()],
        experiences: [
          {
            company: "示例科技",
            role: "后端实习生",
            start_date: "2025.03",
            end_date: "2025.08",
            description: "开发简历生成接口\n优化导出性能",
          },
        ],
        campus_experiences: [
          {
            organization: "计算机协会",
            role: "技术部长",
            start_date: "2024.09",
            end_date: "2025.06",
            description: "组织技术分享",
          },
        ],
        projects: [
          {
            name: "简历通",
            role: "核心开发",
            start_date: "2025.01",
            end_date: "2025.06",
            tech_stack: "Python, FastAPI",
            description: "开发生成接口",
            highlights: "上线即被 200 人使用",
          },
        ],
        skills: [{ name: "Python", level: "熟练" }],
        awards: [{ name: "校级一等奖学金", date: "2024.10", description: "前 5%" }],
      }),
    );

    // 多行文本在表单里是数组：候选必须是同一种形状，否则填进去显示不出来。
    expect(sources.education[0].value).toMatchObject({
      school: "示例大学",
      major: "软件工程",
      courses: ["数据结构", "操作系统"],
      achievements: ["校级奖学金"],
    });
    expect(sources.experience[0].value).toMatchObject({
      company: "示例科技",
      description: ["开发简历生成接口", "优化导出性能"],
    });
    expect(sources.campusExperience[0].value).toMatchObject({
      organization: "计算机协会",
      description: ["组织技术分享"],
    });
    expect(sources.projects[0].value).toMatchObject({
      name: "简历通",
      // 技术栈按逗号拆开（资料里是一整行）。
      tech_stack: ["Python", "FastAPI"],
    });
    expect(sources.skills[0].value).toEqual({ name: "Python", level: "熟练" });
    expect(sources.awards[0].value).toMatchObject({ name: "校级一等奖学金", date: "2024.10" });

    // 标题与次要说明：下拉里要能认出是哪一条。
    expect(sources.education[0].label).toBe("示例大学");
    expect(sources.education[0].hint).toContain("软件工程");
    expect(sources.experience[0].hint).toContain("2025.03 ~ 2025.08");
    expect(sources.projects[0].label).toBe("简历通");
    expect(sources.skills[0].hint).toBe("熟练");
    expect(sources.awards[0].hint).toBe("2024.10");

    // 个人总结去掉首尾空白（资料里的多行文本常常带缩进）。
    expect(sources.summary).toBe("三年后端开发经验，熟悉 Python。");
  });

  it("同一条经历重复时不出现两次", () => {
    const sources = sourcesOf(
      profile({
        educations: [
          education(),
          // 同校同专业同起止时间，只是绩点被改过：还是同一条。
          education({ gpa: "3.9" }),
        ],
        skills: [
          { name: "Python", level: "熟练" },
          { name: "Python", level: "精通" },
        ],
        projects: [
          {
            name: "简历通",
            role: "核心开发",
            start_date: "",
            end_date: "",
            tech_stack: "",
            description: "",
            highlights: "",
          },
        ],
      }),
    );

    // 去重键是资料条目的 entry_id（改过分数仍是同一条）；资料里**两条独立条目**即使
    // 文字相同也各是一条——这正是"按身份而不是按标题猜"的口径，改一条不会影响另一条。
    expect(sources.education).toHaveLength(2);
    expect(sources.skills).toHaveLength(2);
    expect(new Set(sources.education.map((item) => item.key)).size).toBe(2);
    expect(sources.education[0].matchKey).toBe(sources.education[1].matchKey);
    expect(sources.education[0].value).toMatchObject({ gpa: "3.8" });
    expect(sources.skills[0].value).toMatchObject({ level: "熟练" });
  });

  it("同名奖项按日期区分：不同届各留一条", () => {
    const sources = sourcesOf(
      profile({
        awards: [
          { name: "一等奖学金", date: "2023.10", description: "" },
          { name: "一等奖学金", date: "2024.10", description: "" },
        ],
      }),
    );

    expect(sources.awards).toHaveLength(2);
    // 落选（去重掉）的情况：同名同日期。
    expect(awardFillKey({ name: "一等奖学金", date: "2024.10" })).toBe(
      awardFillKey({ name: "一等奖学金", date: "2024.10", description: "改了说明" }),
    );
  });

  it("资料为空时每个模块都是空数组，个人总结是空串", () => {
    const sources = sourcesOf(profile({ summary: "   " }));
    expect(sources.education).toEqual([]);
    expect(sources.experience).toEqual([]);
    expect(sources.campusExperience).toEqual([]);
    expect(sources.projects).toEqual([]);
    expect(sources.skills).toEqual([]);
    expect(sources.awards).toEqual([]);
    expect(sources.summary).toBe("");
  });

  it("整条空白的条目不会成为候选", () => {
    const sources = sourcesOf(
      profile({
        educations: [education({ school: "", major: "", start_date: "", end_date: "" })],
      }),
    );
    // 只有绩点/课程而没有学校专业时间的条目：形状键是全空的——按"无法识别"丢掉，
    // 避免下拉里出现一条空行。
    expect(sources.education).toEqual([]);
  });
});

describe("去重键", () => {
  it("各模块的键只用能认出同一条的最小字段集", () => {
    expect(educationFillKey({ school: "A", major: "B", start_date: "C", end_date: "D" })).toBe(
      "A|B|C|D",
    );
    // 绩点/课程不参与：改了它们仍是同一条教育经历。
    expect(
      educationFillKey({ school: "A", major: "B", start_date: "C", end_date: "D", gpa: "9" }),
    ).toBe("A|B|C|D");
    expect(experienceFillKey({ company: "A", role: "B", start_date: "C", end_date: "D" })).toBe(
      "A|B|C|D",
    );
    expect(campusExperienceFillKey({ organization: "A", role: "B" })).toBe("A|B");
    expect(projectFillKey({ name: "A" })).toBe("A");
    expect(skillFillKey({ name: "A" })).toBe("A");
    expect(awardFillKey({ name: "A", date: "B" })).toBe("A|B");
  });

  it("空白与多余空格被归一化，undefined 不会变成 'undefined'", () => {
    expect(educationFillKey({ school: "  A  ", major: "B  C" })).toBe("A|B C||");
    expect(skillFillKey({})).toBe("");
    expect(skillFillKey(null)).toBe("");
  });
});
