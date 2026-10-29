// SPDX-License-Identifier: Apache-2.0
/**
 * **键盘原地确认不改内容**（面板层回归）。
 *
 * 用户路径：焦点落在某条要点的手柄上 → `Enter` 进入排序会话 → **什么都不按**再 `Enter` 确认。
 * 旧行为：`pointMoveOf` 把"原地"也算成一次扁平插入，于是派发 `move-point`，这一条位置没变、
 * 字段却被改写（教育经历里「主修课程：…」整行消失），并且记了一步历史。
 *
 * 这条用例从面板出发，只认最终的**内容**与**命令种类**：
 * - 内容（`courses` / `achievements` / `point_ids`）必须与初始逐字段深相等；
 * - 命令里**绝不允许**出现 `move-point`（允许 0 条，或 1 条 `reorder-point` 且 `changed:false`）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import { ensureIds } from "../../../features/resume-document/identity";
import { applyOutlineCommand } from "../../../features/resume-outline/commands";
import { entriesOf, entryIdOf } from "../../../features/resume-outline/model";
import type { OutlineCommand } from "../../../features/resume-outline/types";
import type { ResumeContent } from "../../../types/resume";
import { useState } from "react";
import OutlinePanel from "./OutlinePanel";

const COURSE = "市场营销学";
const [AWARD_A, AWARD_B] = ["奖学金", "优秀学生"];

function makeContent(): ResumeContent {
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
        courses: [COURSE],
        achievements: [AWARD_A, AWARD_B],
      },
    ],
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

interface HarnessProps {
  initial: ResumeContent;
  commands: OutlineCommand[];
  latestRef: { current: ResumeContent };
}

function Harness({ initial, commands, latestRef }: HarnessProps) {
  const [content, setContent] = useState<ResumeContent>(initial);
  const onCommand = (command: OutlineCommand, baseContent: ResumeContent) => {
    commands.push(command);
    const result = applyOutlineCommand(baseContent, command);
    if (result.ok) {
      latestRef.current = result.content;
      setContent(result.content);
    }
  };
  return (
    <AntdApp>
      <OutlinePanel content={content} onCommand={onCommand} />
    </AntdApp>
  );
}

function renderPanel(initial: ResumeContent) {
  const commands: OutlineCommand[] = [];
  const latestRef = { current: initial };
  render(
    <AntdApp>
      <Harness initial={initial} commands={commands} latestRef={latestRef} />
    </AntdApp>,
  );
  fireEvent.keyDown(treeitem("section:education"), { key: "ArrowRight" });
  fireEvent.keyDown(treeitem(`entry:education:${entryIdOf(entriesOf(initial, "education")[0])}`), {
    key: "ArrowRight",
  });
  return { commands, latestRef };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("要点手柄上的原地确认（Enter → Enter）", () => {
  it("内容一字不改，且不产生 move-point（绝不静默改写字段）", () => {
    const initial = makeContent();
    const snapshot = JSON.stringify(initial);
    const { commands, latestRef } = renderPanel(initial);

    // 第一条要点手柄 = 课程行（`courses`，扁平下标 0）。
    const handle = screen.getAllByRole("button", { name: t("outline.sort.pointHandle") })[0];
    fireEvent.focus(handle);
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(handle).toHaveAttribute("aria-pressed", "true");
    // 什么都不按，直接确认。
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(handle).toHaveAttribute("aria-pressed", "false");

    // 命令里绝不允许 move-point；最多一条 reorder-point（toIndex 与原来相同 ⇒ changed:false）。
    expect(commands.filter((command) => command.type === "move-point")).toHaveLength(0);
    expect(commands.length).toBeLessThanOrEqual(1);
    for (const command of commands) {
      expect(command.type).toBe("reorder-point");
      expect(applyOutlineCommand(initial, command)).toMatchObject({ changed: false });
    }

    // 内容逐字段不变（stringify 覆盖 courses / achievements / point_ids / hidden 等全部键）。
    expect(JSON.stringify(latestRef.current)).toBe(snapshot);
    const entry = entriesOf(latestRef.current, "education")[0];
    expect(entry.courses).toEqual([COURSE]);
    expect(entry.achievements).toEqual([AWARD_A, AWARD_B]);
    // 纸面上课程行仍在（字段标签还在）——「主修课程：…」不会凭空消失。
    expect(document.querySelector('[data-point-field="courses"]')).not.toBeNull();
  });

  it("反向对照：按一次 ArrowDown 再确认仍然跨字段搬移（原地短路没杀掉正常移动）", () => {
    const initial = makeContent();
    const { commands, latestRef } = renderPanel(initial);

    const handle = screen.getAllByRole("button", { name: t("outline.sort.pointHandle") })[0];
    fireEvent.focus(handle);
    fireEvent.keyDown(handle, { key: "Enter" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.keyDown(handle, { key: "Enter" });

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "move-point",
      fromPointField: "courses",
      toPointField: "achievements",
    });
    const entry = entriesOf(latestRef.current, "education")[0];
    expect(entry.courses).toEqual([]);
    expect(entry.achievements).toHaveLength(3);
  });
});
