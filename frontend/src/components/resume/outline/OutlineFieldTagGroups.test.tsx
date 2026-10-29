// SPDX-License-Identifier: Apache-2.0
/**
 * 字段标签的**分组归属**在跨字段搬移之后仍然正确（QA 补充）。
 *
 * 策略是「每个字段只在**组首那一行**标一次」（`pointFieldGroupLeaders`）。这条策略的风险在于
 * 分组边界：如果实现按"第 N 条"或按下标硬编码，一次跨字段搬移就会让标签挂到错误的行上——
 * 比如被搬走的那条带着旧字段的标签，或者成果组的组首丢了标签。
 *
 * 这里不用拖动，而是直接把**命令产出**的内容渲染出来（要测的是 `OutlineTreeView` 的渲染
 * 策略，不是拖拽通路；拖拽通路已由 `OutlinePanel.crossFieldMove.test.tsx` 覆盖）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ensureIds } from "../../../features/resume-document/identity";
import { applyOutlineCommand } from "../../../features/resume-outline/commands";
import { entriesOf, entryIdOf, pointIdsOf } from "../../../features/resume-outline/model";
import type { ResumeContent } from "../../../types/resume";
import OutlinePanel from "./OutlinePanel";

const SCHOOL = "学校甲";

function content(courses: string[], achievements: string[]): ResumeContent {
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
        school: SCHOOL,
        major: "计算机",
        degree: "本科",
        start_date: "",
        end_date: "",
        gpa: "",
        courses,
        achievements,
      },
    ],
    experience: [],
    campus_experience: [],
    projects: [],
    skills: [],
    awards: [],
  });
}

function firstEntry(source: ResumeContent) {
  return entriesOf(source, "education")[0];
}

function treeitem(key: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-tree-key="${key}"]`);
  if (!element) throw new Error(`treeitem missing: ${key}`);
  return element;
}

function renderPanel(source: ResumeContent): void {
  render(
    <AntdApp>
      <OutlinePanel content={source} onCommand={() => undefined} />
    </AntdApp>,
  );
  // 展开第一个条目（板块默认已展开）。
  fireEvent.keyDown(treeitem(`entry:education:${entryIdOf(firstEntry(source))}`), {
    key: "ArrowRight",
  });
}

/** 每一行要点行上的标签字段（按 DOM 顺序 = 扁平顺序）。 */
function tagsPerPointRow(): string[][] {
  return Array.from(document.querySelectorAll<HTMLElement>(".resume-outline-row.is-point")).map(
    (row) =>
      Array.from(row.querySelectorAll<HTMLElement>(".resume-outline-field-tag")).map(
        (tag) => tag.dataset.pointField ?? "",
      ),
  );
}

/** 每一行要点行的正文。 */
function pointRowTexts(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      ".resume-outline-row.is-point .resume-outline-point-text",
    ),
  ).map((element) => element.textContent?.trim() ?? "");
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("跨字段搬移之后：标签仍然挂在正确的组首", () => {
  it("搬走一条后成果组仍有两个字段 → 组首带标签、组内第二条与搬来的那条都不带", () => {
    const before = content(["课程一", "课程二"], ["成果一", "成果二", "成果三"]);
    const objectId = entryIdOf(firstEntry(before));
    const movedId = pointIdsOf(firstEntry(before), "courses")[0];
    // 把「课程一」搬进 achievements 的下标 1 → achievements = [成果一, 课程一, 成果二, 成果三]
    const result = applyOutlineCommand(before, {
      type: "move-point",
      field: "education",
      objectId,
      fromPointField: "courses",
      toPointField: "achievements",
      pointId: movedId,
      toIndex: 1,
    });
    if (!result.ok) throw new Error(`命令被拒绝：${result.reason}`);
    expect(firstEntry(result.content).courses).toEqual(["课程二"]);
    expect(firstEntry(result.content).achievements).toEqual([
      "成果一",
      "课程一",
      "成果二",
      "成果三",
    ]);

    renderPanel(result.content);

    // 扁平顺序：课程二（courses 组首）→ 成果一（achievements 组首）→ 课程一 → 成果二 → 成果三
    expect(pointRowTexts()).toEqual(["课程二", "成果一", "课程一", "成果二", "成果三"]);
    expect(tagsPerPointRow()).toEqual([
      ["courses"], // 组首：核心课程
      ["achievements"], // 组首：在校成果（**没有丢**）
      [], // 被搬来的「课程一」：不得残留 courses 标签
      [], // 组内第二条：不重复标注
      [],
    ]);
  });

  it("把唯一一条课程搬空后只剩一个字段 → 整组不标（标签是 2+ 字段才有的信息）", () => {
    const before = content(["课程一"], ["成果一", "成果二"]);
    const objectId = entryIdOf(firstEntry(before));
    const movedId = pointIdsOf(firstEntry(before), "courses")[0];
    const result = applyOutlineCommand(before, {
      type: "move-point",
      field: "education",
      objectId,
      fromPointField: "courses",
      toPointField: "achievements",
      pointId: movedId,
      toIndex: 2,
    });
    if (!result.ok) throw new Error(`命令被拒绝：${result.reason}`);

    renderPanel(result.content);
    expect(tagsPerPointRow()).toEqual([[], [], []]);
  });

  it("对照组：搬移之前同样正确（每组只在组首标一次）", () => {
    renderPanel(content(["课程一", "课程二"], ["成果一", "成果二"]));
    expect(pointRowTexts()).toEqual(["课程一", "课程二", "成果一", "成果二"]);
    expect(tagsPerPointRow()).toEqual([["courses"], [], ["achievements"], []]);
  });
});
