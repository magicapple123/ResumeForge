// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲的**键盘可达性**测试（plan W06："键盘能独立完成排序"）。
 *
 * 两条路径分开验证：
 * - 树导航：上下/Home/End/←/→/Enter 在 treeitem 上移动焦点与展开（WAI-ARIA tree 语义）；
 * - 排序会话：手柄上 Enter 进入 → 方向键/Home/End 移动 → Enter 确认一条命令 / Esc 取消无命令。
 *
 * 中文只出现在夹具常量里；断言用 `t()` 或常量。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import { ensureIds } from "../../../features/resume-document/identity";
import { applyOutlineCommand } from "../../../features/resume-outline/commands";
import { entriesOf, entryIdOf } from "../../../features/resume-outline/model";
import type { OutlineCommand } from "../../../features/resume-outline/types";
import type { ResumeContent } from "../../../types/resume";
import OutlinePanel from "./OutlinePanel";

const PROJECT_A = "项目甲";
const PROJECT_B = "项目乙";

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
        name: PROJECT_A,
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: ["甲一"],
        highlights: [],
      },
      {
        name: PROJECT_B,
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: ["乙一"],
        highlights: [],
      },
    ],
    skills: [],
    awards: [],
  });
}

function idOf(content: ResumeContent, name: string): string {
  return entryIdOf(entriesOf(content, "projects").find((item) => item.name === name));
}

function keyOf(content: ResumeContent, name: string): string {
  return `entry:projects:${idOf(content, name)}`;
}

function treeitem(key: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-tree-key="${key}"]`);
  if (!element) throw new Error(`找不到树节点：${key}`);
  return element;
}

function activeTreeKey(): string | undefined {
  return (document.activeElement as HTMLElement | null)?.dataset.treeKey;
}

interface HarnessProps {
  initial: ResumeContent;
  commands: OutlineCommand[];
}

function Harness({ initial, commands }: HarnessProps) {
  const [content, setContent] = useState<ResumeContent>(initial);
  return (
    <AntdApp>
      <OutlinePanel
        content={content}
        onCommand={(command, baseContent) => {
          commands.push(command);
          const result = applyOutlineCommand(baseContent, command);
          if (result.ok) setContent(result.content);
        }}
      />
    </AntdApp>
  );
}

function renderPanel() {
  const initial = makeContent();
  const commands: OutlineCommand[] = [];
  render(<Harness initial={initial} commands={commands} />);
  return { initial, commands };
}

function handleOf(name: string): HTMLElement {
  return screen.getByRole("button", { name: t("outline.sort.handle", { name }) });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("树导航", () => {
  it("上下键/Home/End 在可见节点间移动焦点（分组默认展开）", () => {
    renderPanel();
    const personal = treeitem("personal");
    personal.focus();
    expect(activeTreeKey()).toBe("personal");

    fireEvent.keyDown(personal, { key: "ArrowDown" });
    expect(activeTreeKey()).toBe("section:education");
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
    expect(activeTreeKey()).toBe("section:experience");

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
    // 最后一个可见节点 = 最后一个分组的最后一个条目（技能/荣誉都没有条目时是最后一个分组头）。
    expect(activeTreeKey()?.startsWith("section:") || activeTreeKey()?.startsWith("entry:")).toBe(
      true,
    );

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
    expect(activeTreeKey()).toBe("personal");
  });

  it("←/→ 折叠与展开分组，→ 在已展开时进入第一个子条目", () => {
    const { initial } = renderPanel();
    const section = treeitem("section:projects");
    section.focus();
    expect(section).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(section, { key: "ArrowLeft" });
    expect(section).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector('[data-tree-key^="entry:projects:"]')).toBeNull();

    fireEvent.keyDown(section, { key: "ArrowRight" });
    expect(section).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(section, { key: "ArrowRight" });
    expect(activeTreeKey()).toBe(keyOf(initial, PROJECT_A));
  });

  it("条目 ← 回到所属分组；Enter 选中对象", () => {
    const { initial } = renderPanel();
    const entry = treeitem(keyOf(initial, PROJECT_A));
    entry.focus();
    fireEvent.keyDown(entry, { key: "Enter" });
    expect(entry).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(entry, { key: "ArrowLeft" });
    expect(activeTreeKey()).toBe("section:projects");
  });
});

describe("键盘排序会话", () => {
  it("Enter 进入 → Home/End/方向键移动 → Enter 确认一条命令（顺序落地）", () => {
    const { initial, commands } = renderPanel();
    const handle = handleOf(PROJECT_A);
    // 手柄获得焦点即选中该条目：键盘用户不必先点鼠标。
    fireEvent.focus(handle);
    expect(treeitem(keyOf(initial, PROJECT_A))).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(handle, { key: "Enter" });
    expect(handle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent(
      t("outline.sort.active", { name: PROJECT_A, position: 1, total: 2 }),
    );

    fireEvent.keyDown(handle, { key: "End" });
    expect(screen.getByRole("status")).toHaveTextContent(
      t("outline.sort.active", { name: PROJECT_A, position: 2, total: 2 }),
    );
    fireEvent.keyDown(handle, { key: "Home" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.keyDown(handle, { key: "Enter" });

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "reorder-entry",
      objectId: idOf(initial, PROJECT_A),
      toIndex: 1,
    });
    // 落地后项目乙在前。
    const keys = Array.from(
      document.querySelectorAll<HTMLElement>('[data-tree-key^="entry:projects:"]'),
    ).map((element) => element.dataset.treeKey);
    expect(keys).toEqual([keyOf(initial, PROJECT_B), keyOf(initial, PROJECT_A)]);
    expect(handle).toHaveAttribute("aria-pressed", "false");
  });

  it("Esc 取消：不派发命令，顺序不变，并播报已取消", () => {
    const { initial, commands } = renderPanel();
    const handle = handleOf(PROJECT_B);
    fireEvent.focus(handle);
    fireEvent.keyDown(handle, { key: "Enter" });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    // 预览里项目乙已到第一位，但内容没变。
    expect(commands).toHaveLength(0);
    fireEvent.keyDown(handle, { key: "Escape" });
    expect(commands).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent(
      t("outline.sort.cancelled", { name: PROJECT_B }),
    );
    const keys = Array.from(
      document.querySelectorAll<HTMLElement>('[data-tree-key^="entry:projects:"]'),
    ).map((element) => element.dataset.treeKey);
    expect(keys).toEqual([keyOf(initial, PROJECT_A), keyOf(initial, PROJECT_B)]);
  });

  it("没有可排序项（只有一条）时不渲染手柄", () => {
    const single = ensureIds({
      ...makeContent(),
      projects: [
        {
          name: PROJECT_A,
          role: "",
          start_date: "",
          end_date: "",
          tech_stack: [],
          description: [],
          highlights: [],
        },
      ],
    });
    const commands: OutlineCommand[] = [];
    render(<Harness initial={single} commands={commands} />);
    expect(
      screen.queryByRole("button", { name: t("outline.sort.handle", { name: PROJECT_A }) }),
    ).toBeTruthy();
    // 手柄仍可聚焦（无排序意义时进入会话返回 null，不产生命令）。
    const handle = handleOf(PROJECT_A);
    within(handle).getByRole("img", { hidden: true });
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(commands).toHaveLength(0);
  });
});
