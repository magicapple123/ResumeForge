// SPDX-License-Identifier: Apache-2.0
/**
 * 「文档大纲」面板的渲染/交互测试（W06 / P1-01、D01）。
 *
 * 覆盖 acceptance 里"看起来能用、其实会串位"的部分：
 * - 点条目 → 选中并显示该对象适用的最小属性区；
 * - 属性区改可见性/锁定/复制 = 真实派发 `OutlineCommand`（不是只改本地 UI）；
 * - 多选批量隐藏：一条命令带上全部选中条目；
 * - 纸面点击（pickTarget）反向选中并展开到要点；
 * - 选中对象 → 向画布 iframe 注入高亮（与 paper pick 同一套路径口径）。
 *
 * 树节点统一用 `data-tree-key` 定位：role=treeitem 的可访问名会把子树文本算进去
 * （分组的名字天然包含所有条目），按名字查会同时命中父子节点。
 * 中文只出现在夹具常量里；断言用 `t()` 或常量，避免 `cjkRatchet` 的 tests 口径。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import { ensureIds } from "../../../features/resume-document/identity";
import { applyOutlineCommand } from "../../../features/resume-outline/commands";
import {
  buildOutline,
  entriesOf,
  entryIdOf,
  pointIdsOf,
} from "../../../features/resume-outline/model";
import type { OutlineCommand } from "../../../features/resume-outline/types";
import type { ResumeContent } from "../../../types/resume";
import OutlinePanel from "./OutlinePanel";

const PROJECT_A = "项目甲";
const PROJECT_B = "项目乙";
const POINT_B1 = "做了乙一";
const POINT_B2 = "做了乙二";

function makeContent(): ResumeContent {
  return ensureIds({
    photo: "",
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
    education: [],
    experience: [],
    campus_experience: [],
    projects: [
      {
        name: PROJECT_A,
        role: "负责人",
        start_date: "",
        end_date: "",
        tech_stack: ["Python"],
        description: ["做了甲"],
        highlights: ["上线了"],
      },
      {
        name: PROJECT_B,
        role: "开发",
        start_date: "",
        end_date: "",
        tech_stack: ["TypeScript"],
        description: [POINT_B1, POINT_B2],
        highlights: ["获奖了"],
      },
    ],
    skills: [{ name: "Python", level: "熟练" }],
    awards: [{ name: "一等奖", date: "2021", description: "" }],
  });
}

function projectId(content: ResumeContent, name: string): string {
  return entryIdOf(entriesOf(content, "projects").find((item) => item.name === name));
}

function entryTreeKey(content: ResumeContent, name: string): string {
  return `entry:projects:${projectId(content, name)}`;
}

function pointTreeKey(
  content: ResumeContent,
  name: string,
  text: string,
  pointField = "description",
): string {
  const entry = entriesOf(content, "projects").find((item) => item.name === name);
  const values = Array.isArray(entry?.[pointField]) ? (entry?.[pointField] as unknown[]) : [];
  const index = values.indexOf(text);
  const pointId = pointIdsOf(entry, pointField)[index];
  return `point:projects:${entryIdOf(entry)}:${pointField}:${pointId}`;
}

function treeitem(key: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-tree-key="${key}"]`);
  if (!element) throw new Error(`找不到树节点：${key}`);
  return element;
}

function projectTreeitems(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-tree-key^="entry:projects:"]'));
}

interface HarnessProps {
  initial?: ResumeContent;
  commands: OutlineCommand[];
  pickTarget?: { path: string; nonce: number } | null;
  canvasContainer?: HTMLElement | null;
  readOnly?: boolean;
}

function Harness({
  initial,
  commands,
  pickTarget,
  canvasContainer,
  readOnly = false,
}: HarnessProps) {
  const [content, setContent] = useState<ResumeContent | undefined>(initial);
  const handleCommand = (command: OutlineCommand, baseContent: ResumeContent) => {
    commands.push(command);
    // 与 wb-core 约定的集成方式：applyOutlineCommand(baseContent, command) → 写回内容状态。
    const result = applyOutlineCommand(baseContent, command);
    if (result.ok) setContent(result.content);
  };
  return (
    <AntdApp>
      <OutlinePanel
        content={content}
        readOnly={readOnly || undefined}
        pickTarget={pickTarget}
        canvasContainer={canvasContainer}
        onCommand={readOnly ? undefined : handleCommand}
      />
    </AntdApp>
  );
}

function renderPanel(options: Omit<HarnessProps, "commands"> = {}) {
  const commands: OutlineCommand[] = [];
  const utils = render(<Harness commands={commands} {...options} />);
  return { ...utils, commands };
}

function iconButton(container: HTMLElement, label: string): HTMLElement {
  // 带图标的 antd 按钮可访问名 = 图标名 + 文案，所以按子串匹配。
  return within(container).getByRole("button", { name: new RegExp(label) });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("渲染与选择", () => {
  it("分组/条目/要点按内容渲染；计数字段正确", () => {
    const initial = makeContent();
    renderPanel({ initial });
    expect(screen.getByText(t("outline.panel.title"))).toBeInTheDocument();
    expect(
      screen.getByText(t("outline.count.summary", { entries: 4, points: 7 })),
    ).toBeInTheDocument();
    for (const key of [
      "outline.section.personal",
      "outline.section.education",
      "outline.section.experience",
      "outline.section.campus_experience",
      "outline.section.projects",
      "outline.section.skills",
      "outline.section.awards",
    ] as const) {
      expect(screen.getByText(t(key))).toBeInTheDocument();
    }
    expect(treeitem(entryTreeKey(initial, PROJECT_B))).toBeInTheDocument();
    expect(buildOutline(initial).entryCount).toBe(4);
  });

  it("点条目 → aria-selected 生效，属性区显示条目操作；再点个人信息切换对象", () => {
    const initial = makeContent();
    renderPanel({ initial });
    const entry = treeitem(entryTreeKey(initial, PROJECT_B));
    fireEvent.click(within(entry).getByText(PROJECT_B));
    expect(entry).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(t("outline.inspector.kind.entry"))).toBeInTheDocument();
    expect(iconButton(document.body, t("outline.action.clone"))).toBeInTheDocument();

    fireEvent.click(treeitem("personal"));
    const inspector = screen.getByRole("region", { name: t("outline.inspector.title") });
    expect(within(inspector).getByText(t("outline.inspector.kind.personal"))).toBeInTheDocument();
    expect(screen.getByText(t("outline.inspector.personalHint"))).toBeInTheDocument();
  });

  it("展开条目后能看到每条要点，点要点后属性区显示要点文本与所属条目", () => {
    const initial = makeContent();
    renderPanel({ initial });
    const entry = treeitem(entryTreeKey(initial, PROJECT_B));
    // 键盘等价物（←/→）展开：这里验证树导航本身，鼠标路径另有单元测试。
    fireEvent.keyDown(entry, { key: "ArrowRight" });
    expect(entry).toHaveAttribute("aria-expanded", "true");
    const point = treeitem(pointTreeKey(initial, PROJECT_B, POINT_B2));
    fireEvent.click(within(point).getByText(POINT_B2));
    expect(screen.getByText(t("outline.inspector.kind.point"))).toBeInTheDocument();
    expect(
      screen.getByText(t("outline.inspector.parentEntry", { name: PROJECT_B })),
    ).toBeInTheDocument();
  });

  it("空简历显示空态而不是空树", () => {
    const empty = ensureIds({
      photo: "",
      name: "",
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
      projects: [],
      skills: [],
      awards: [],
    });
    renderPanel({ initial: empty });
    expect(screen.getByText(t("outline.empty"))).toBeInTheDocument();
    expect(screen.queryByRole("tree")).toBeNull();
  });
});

describe("属性区结构操作", () => {
  it("隐藏开关派发 set-hidden(true)；再关掉是 hidden=false（后端按删键处理）", () => {
    const initial = makeContent();
    const { commands } = renderPanel({ initial });
    fireEvent.click(within(treeitem(entryTreeKey(initial, PROJECT_B))).getByText(PROJECT_B));
    const hiddenSwitch = () =>
      screen.getByRole("switch", { name: t("outline.inspector.toggleHidden") });
    fireEvent.click(hiddenSwitch());
    expect(commands[0]).toMatchObject({ type: "set-hidden", hidden: true });
    expect(commands[0].type === "set-hidden" && commands[0].entries).toHaveLength(1);
    expect(screen.getAllByText(t("outline.hidden.badge")).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(hiddenSwitch());
    expect(commands[1]).toMatchObject({ type: "set-hidden", hidden: false });
  });

  it("复制条目：同一对象出现两份，命令按 id 指向原条目", () => {
    const initial = makeContent();
    const { commands } = renderPanel({ initial });
    fireEvent.click(within(treeitem(entryTreeKey(initial, PROJECT_A))).getByText(PROJECT_A));
    fireEvent.click(iconButton(document.body, t("outline.action.clone")));
    expect(commands[0]).toMatchObject({ type: "clone-entry", field: "projects" });
    expect(projectTreeitems()).toHaveLength(3);
  });

  it("锁布局后排序被拒绝并给出可执行的原因说明", () => {
    const initial = makeContent();
    const { commands } = renderPanel({ initial });
    fireEvent.click(within(treeitem(entryTreeKey(initial, PROJECT_B))).getByText(PROJECT_B));
    fireEvent.click(screen.getByRole("switch", { name: t("outline.inspector.toggleLayout") }));
    expect(commands[0]).toMatchObject({ type: "set-lock", lock: "layout", value: true });
    const handle = screen.getByRole("button", {
      name: t("outline.sort.handle", { name: PROJECT_B }),
    });
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(screen.getByRole("status")).toHaveTextContent(t("outline.blocked.locked-layout"));
    expect(commands).toHaveLength(1);
  });

  it("多选（空格）→ 批量隐藏 = 一条命令带两个条目", () => {
    const initial = makeContent();
    const { commands } = renderPanel({ initial });
    fireEvent.keyDown(treeitem(entryTreeKey(initial, PROJECT_A)), { key: " " });
    fireEvent.keyDown(treeitem(entryTreeKey(initial, PROJECT_B)), { key: " " });
    expect(screen.getByText(t("outline.batch.selected", { count: 2 }))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("outline.batch.hide") }));
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ type: "set-hidden", hidden: true });
    expect(commands[0].type === "set-hidden" && commands[0].entries).toHaveLength(2);
    expect(screen.queryByText(t("outline.batch.selected", { count: 2 }))).toBeNull();
    // 两个条目行各一个徽标（没选中对象时属性区不渲染徽标）。
    expect(screen.getAllByText(t("outline.hidden.badge"))).toHaveLength(2);
  });
});

describe("纸面反向选中与画布高亮", () => {
  function canvasWithIframe(): HTMLElement {
    const host = document.createElement("div");
    host.appendChild(document.createElement("iframe"));
    document.body.appendChild(host);
    return host;
  }

  it("pickTarget 自动展开到要点并选中；iframe 里注入精确高亮", async () => {
    const initial = makeContent();
    const host = canvasWithIframe();
    renderPanel({
      initial,
      canvasContainer: host,
      pickTarget: { path: "projects.1.description.1", nonce: 1 },
    });
    const point = await waitFor(() => treeitem(pointTreeKey(initial, PROJECT_B, POINT_B2)));
    expect(point).toHaveAttribute("aria-selected", "true");
    const frame = host.querySelector("iframe");
    await waitFor(() => {
      const style = frame?.contentDocument?.getElementById("rf-outline-highlight");
      expect(style).not.toBeNull();
      expect(style?.textContent).toContain('[data-resume-path="projects.1.description.1"]');
    });
  });

  it("选中条目后高亮是前缀选择器（整条经历都亮）", async () => {
    const initial = makeContent();
    const host = canvasWithIframe();
    renderPanel({ initial, canvasContainer: host });
    fireEvent.click(within(treeitem(entryTreeKey(initial, PROJECT_A))).getByText(PROJECT_A));
    const frame = host.querySelector("iframe");
    await waitFor(() => {
      const style = frame?.contentDocument?.getElementById("rf-outline-highlight");
      expect(style?.textContent).toContain('[data-resume-path^="projects.0."]');
    });
  });
});

describe("只读宿主", () => {
  it("没有 onCommand 时不渲染排序手柄，属性区禁用并说明只读", () => {
    const initial = makeContent();
    renderPanel({ initial, readOnly: true });
    expect(screen.getByText(t("outline.readonly"))).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("outline.sort.handle", { name: PROJECT_B }) }),
    ).toBeNull();
    fireEvent.click(within(treeitem(entryTreeKey(initial, PROJECT_B))).getByText(PROJECT_B));
    expect(
      screen.getByRole("switch", { name: t("outline.inspector.toggleHidden") }),
    ).toBeDisabled();
  });
});

describe("id 稳定性（选中不串位）", () => {
  it("排序命令携带的 id 与内容里的 id 一致，而不是下标；提交后选中对象不变", () => {
    const initial = makeContent();
    const { commands } = renderPanel({ initial });
    const projectBId = projectId(initial, PROJECT_B);
    fireEvent.click(within(treeitem(entryTreeKey(initial, PROJECT_B))).getByText(PROJECT_B));
    const handle = screen.getByRole("button", {
      name: t("outline.sort.handle", { name: PROJECT_B }),
    });
    fireEvent.keyDown(handle, { key: "Enter" });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "reorder-entry",
      field: "projects",
      objectId: projectBId,
      toIndex: 0,
    });
    // 排序后项目乙排到第一位，选中状态仍跟着它（id 没换）。
    expect(projectTreeitems()[0]).toHaveAttribute(
      "data-tree-key",
      entryTreeKey(initial, PROJECT_B),
    );
    expect(projectTreeitems()[0]).toHaveAttribute("aria-selected", "true");
  });
});
