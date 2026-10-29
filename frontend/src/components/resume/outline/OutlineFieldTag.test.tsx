// SPDX-License-Identifier: Apache-2.0
/**
 * 要点行的**字段归属标签**：一个条目的要点来自多个数组（`courses` / `achievements` …）时，
 * 扁平展示的四行长得一样，必须标出"这一行属于哪个字段"，否则用户看不出第一条是课程行
 * （跨字段搬移之后，"搬走的是哪一条"才有意义）。
 *
 * 两个方向都要钉住：**有 ≥2 个非空要点字段时出现**、**只有 1 个字段时不出现**（避免噪音）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import { ensureIds } from "../../../features/resume-document/identity";
import { entriesOf, entryIdOf } from "../../../features/resume-outline/model";
import type { ResumeContent } from "../../../types/resume";
import OutlinePanel from "./OutlinePanel";

function education(school: string, courses: string[], achievements: string[]) {
  return {
    school,
    major: "市场营销",
    degree: "本科",
    gpa: "",
    start_date: "",
    end_date: "",
    courses,
    achievements,
  };
}

function content(entries: ReturnType<typeof education>[]): ResumeContent {
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
    education: entries,
    experience: [],
    campus_experience: [],
    projects: [],
    skills: [],
    awards: [],
  });
}

function treeitem(key: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-tree-key="${key}"]`);
  if (!element) throw new Error("treeitem missing: " + key);
  return element;
}

function renderPanel(source: ResumeContent) {
  render(
    <AntdApp>
      <OutlinePanel content={source} onCommand={() => undefined} />
    </AntdApp>,
  );
  // 展开教育经历板块与第一个条目（要点行才会渲染）。
  fireEvent.keyDown(treeitem("section:education"), { key: "ArrowRight" });
  const first = entriesOf(source, "education")[0];
  fireEvent.keyDown(treeitem(`entry:education:${entryIdOf(first)}`), { key: "ArrowRight" });
}

function tagTexts(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".resume-outline-field-tag")).map(
    (element) => element.textContent ?? "",
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("要点行的字段归属标签", () => {
  it("条目有 2 个非空要点字段 → 每组第一条带标签，文案复用编辑器字段名", () => {
    renderPanel(content([education("上海大学", ["市场营销学"], ["奖学金", "优秀学生"])]));
    const tags = tagTexts();
    // 「在校成果」只在组首那一行标一次：同组连续两行写同一个词只是噪音。
    expect(tags).toEqual([t("editor.field.courses"), t("editor.field.studyAchievements")]);
    // `data-point-field` 便于定位"某一行属于哪个字段"（测试与调试都用它）。
    const fields = Array.from(
      document.querySelectorAll<HTMLElement>(".resume-outline-field-tag"),
    ).map((element) => element.dataset.pointField);
    expect(fields).toEqual(["courses", "achievements"]);
  });

  it("标签挂在对应那一行上（不是统一挂在最上面）：课程行有、成果第二行没有", () => {
    renderPanel(content([education("上海大学", ["市场营销学"], ["奖学金", "优秀学生"])]));
    const rows = Array.from(document.querySelectorAll<HTMLElement>(".resume-outline-row.is-point"));
    const tagsPerRow = rows.map((row) =>
      Array.from(row.querySelectorAll<HTMLElement>(".resume-outline-field-tag")).map(
        (tag) => tag.dataset.pointField,
      ),
    );
    expect(tagsPerRow).toEqual([["courses"], ["achievements"], []]);
  });

  it("条目只有 1 个非空要点字段 → 不显示标签（纯噪音）", () => {
    renderPanel(content([education("上海大学", ["市场营销学"], [])]));
    expect(tagTexts()).toEqual([]);
  });

  it("另一个字段为空数组时不算「两个字段」（空字段本来就不渲染要点行）", () => {
    renderPanel(content([education("上海大学", [], ["奖学金"])]));
    expect(tagTexts()).toEqual([]);
  });
});
