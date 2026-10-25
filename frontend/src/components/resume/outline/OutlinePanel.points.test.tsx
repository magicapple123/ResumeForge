// SPDX-License-Identifier: Apache-2.0
/** W06 要点级隐藏/复制：面板行内动作 → 真实命令 → 内容写回后的可见反馈。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import { ensureIds } from "../../../features/resume-document/identity";
import { applyOutlineCommand } from "../../../features/resume-outline/commands";
import { entriesOf, entryIdOf, pointIdsOf } from "../../../features/resume-outline/model";
import type { OutlineCommand } from "../../../features/resume-outline/types";
import type { ResumeContent } from "../../../types/resume";
import { useState } from "react";
import OutlinePanel from "./OutlinePanel";

const POINT_ONE = "要点一";
const POINT_TWO = "要点二";

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
    education: [],
    experience: [],
    campus_experience: [],
    projects: [
      {
        name: "项目甲",
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: [POINT_ONE, POINT_TWO],
        highlights: [],
      },
    ],
    skills: [],
    awards: [],
  });
}

function entryKey(content: ResumeContent): string {
  return `entry:projects:${entryIdOf(entriesOf(content, "projects")[0])}`;
}

function treeitem(key: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-tree-key="${key}"]`);
  if (!element) throw new Error("treeitem missing: " + key);
  return element;
}

interface HarnessProps {
  initial: ResumeContent;
  commands: OutlineCommand[];
}

function Harness({ initial, commands }: HarnessProps) {
  const [content, setContent] = useState<ResumeContent>(initial);
  const onCommand = (command: OutlineCommand, baseContent: ResumeContent) => {
    commands.push(command);
    const result = applyOutlineCommand(baseContent, command);
    if (result.ok) setContent(result.content);
  };
  return (
    <AntdApp>
      <OutlinePanel content={content} onCommand={onCommand} />
    </AntdApp>
  );
}

function renderPanel(initial: ResumeContent, onCommand?: boolean) {
  const commands: OutlineCommand[] = [];
  render(
    <AntdApp>
      {onCommand === false ? (
        <OutlinePanel content={initial} readOnly />
      ) : (
        <Harness initial={initial} commands={commands} />
      )}
    </AntdApp>,
  );
  return commands;
}

function expandEntry(content: ResumeContent) {
  fireEvent.keyDown(treeitem(entryKey(content)), { key: "ArrowRight" });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("要点级隐藏", () => {
  it("点行内隐藏按钮 → set-hidden-points（按 point id）；写回后出现「要点已隐藏」徽标", () => {
    const content = makeContent();
    const commands = renderPanel(content);
    expandEntry(content);
    const pointId = pointIdsOf(entriesOf(content, "projects")[0], "description")[0];
    fireEvent.click(screen.getAllByRole("button", { name: t("outline.point.hide") })[0]);
    expect(commands).toHaveLength(1);
    const command = commands[0];
    expect(command.type).toBe("set-hidden-points");
    if (command.type !== "set-hidden-points") return;
    expect(command.hidden).toBe(true);
    expect(command.objectId).toBe(entryIdOf(entriesOf(content, "projects")[0]));
    expect(command.points).toEqual([{ pointField: "description", pointId }]);
    expect(screen.getByText(t("outline.point.hiddenBadge"))).toBeInTheDocument();
    // 条目行尾出现"1 条要点已隐藏"汇总徽标。
    expect(screen.getByText(t("outline.hiddenPoints.badge", { count: 1 }))).toBeInTheDocument();
  });

  it("再点一次 → set-hidden-points hidden=false；徽标消失（取消是删键）", () => {
    const content = makeContent();
    const commands = renderPanel(content);
    expandEntry(content);
    fireEvent.click(screen.getAllByRole("button", { name: t("outline.point.hide") })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: t("outline.point.show") })[0]);
    expect(commands).toHaveLength(2);
    expect(commands[1]).toMatchObject({ type: "set-hidden-points", hidden: false });
    expect(screen.queryByText(t("outline.point.hiddenBadge"))).toBeNull();
  });
});

describe("要点复制", () => {
  it("点复制 → clone-point；写回后同一条目多一条要点（新身份、相邻插入）", () => {
    const content = makeContent();
    const commands = renderPanel(content);
    expandEntry(content);
    expect(screen.getAllByText(POINT_ONE)).toHaveLength(1);
    fireEvent.click(screen.getAllByRole("button", { name: t("outline.point.clone") })[0]);
    expect(commands[0]).toMatchObject({ type: "clone-point", pointField: "description" });
    expect(screen.getAllByText(POINT_ONE)).toHaveLength(2);
  });
});

describe("无障碍与只读", () => {
  it("要点动作是真正的 button（可聚焦、有 aria-label）", () => {
    const content = makeContent();
    renderPanel(content);
    expandEntry(content);
    const hide = screen.getAllByRole("button", { name: t("outline.point.hide") })[0];
    expect(hide.tagName).toBe("BUTTON");
    expect(hide).toHaveAttribute("aria-label", t("outline.point.hide"));
  });

  it("只读宿主不渲染要点动作按钮", () => {
    const content = makeContent();
    renderPanel(content, false);
    expandEntry(content);
    expect(screen.getAllByText(POINT_ONE).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("button", { name: t("outline.point.hide") })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: t("outline.point.clone") })).toHaveLength(0);
  });
});
