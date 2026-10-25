// SPDX-License-Identifier: Apache-2.0
/**
 * D01：大纲搜索（过滤/高亮/键盘上下+Enter 定位）、滚动位置记忆与恢复、多选上报。
 *
 * jsdom 没有布局：滚动用"元素上的 scrollTop 值"断言（面板读/写的是同一个属性），
 * scrollIntoView 用桩记录调用。
 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { ensureIds } from "../../../features/resume-document/identity";
import { applyOutlineCommand } from "../../../features/resume-outline/commands";
import { entriesOf, entryIdOf, pointIdsOf } from "../../../features/resume-outline/model";
import type { OutlineCommand, OutlineSelection } from "../../../features/resume-outline/types";
import type { ResumeContent } from "../../../types/resume";
import OutlinePanel from "./OutlinePanel";
import type { OutlineMultiEntry, OutlineMultiSelectionApi } from "./OutlinePanel";

const GATEWAY = "支付网关";
const PLATFORM = "数据平台";
const POINT_MONITOR = "补齐监控告警";
const POINT_REPORT = "离线报表";

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
        name: GATEWAY,
        role: "负责人",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: ["把结算链路拆成两个服务", POINT_MONITOR],
        highlights: [],
      },
      {
        name: PLATFORM,
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

function entryKey(content: ResumeContent, name: string): string {
  const entry = entriesOf(content, "projects").find((item) => item.name === name);
  return `entry:projects:${entryIdOf(entry)}`;
}

function pointKey(content: ResumeContent, name: string, text: string): string {
  const entry = entriesOf(content, "projects").find((item) => item.name === name);
  const values = Array.isArray(entry?.description) ? (entry?.description as unknown[]) : [];
  const index = values.indexOf(text);
  return `point:projects:${entryIdOf(entry)}:description:${pointIdsOf(entry, "description")[index]}`;
}

function treeitem(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tree-key="${key}"]`);
}

interface HarnessProps {
  initial: ResumeContent;
  commands: OutlineCommand[];
  pickTarget?: { path: string; nonce: number } | null;
  canvasContainer?: HTMLElement | null;
  onLocateSelection?: (selection: OutlineSelection, path: string | null) => void;
  onMultiSelectionChange?: (entries: OutlineMultiEntry[]) => void;
  multiSelectionApiRef?: RefObject<OutlineMultiSelectionApi | null>;
}

function Harness({
  initial,
  commands,
  pickTarget = null,
  canvasContainer,
  onLocateSelection,
  onMultiSelectionChange,
  multiSelectionApiRef,
}: HarnessProps) {
  const [content, setContent] = useState<ResumeContent>(initial);
  const onCommand = (command: OutlineCommand, baseContent: ResumeContent) => {
    commands.push(command);
    const result = applyOutlineCommand(baseContent, command);
    if (result.ok) setContent(result.content);
  };
  return (
    <AntdApp>
      <OutlinePanel
        content={content}
        onCommand={onCommand}
        pickTarget={pickTarget}
        canvasContainer={canvasContainer}
        onLocateSelection={onLocateSelection}
        onMultiSelectionChange={onMultiSelectionChange}
        multiSelectionApiRef={multiSelectionApiRef}
      />
    </AntdApp>
  );
}

function searchInput(): HTMLElement {
  return screen.getByRole("textbox", { name: t("outline.search.label") });
}

function typeQuery(value: string) {
  fireEvent.change(searchInput(), { target: { value } });
}

beforeEach(() => {
  // jsdom 不实现 scrollIntoView：装一个桩，断言"定位时确实尝试滚了行"。
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("搜索过滤与高亮", () => {
  it("按条目/要点文本过滤：命中行与祖先保留，其它行不渲染，命中片段是 <mark>", () => {
    const content = makeContent();
    render(<Harness initial={content} commands={[]} />);
    typeQuery("监控");
    const hit = treeitem(pointKey(content, GATEWAY, POINT_MONITOR));
    expect(hit).not.toBeNull();
    expect(hit?.querySelector("mark")?.textContent).toBe("监控");
    expect(screen.queryByText(GATEWAY)).not.toBeNull();
    expect(screen.queryByText(PLATFORM)).toBeNull();
    expect(screen.queryByText(POINT_REPORT)).toBeNull();
  });

  it("按板块标题过滤：整个板块保留；没有命中时显示「没有匹配」", () => {
    const content = makeContent();
    render(<Harness initial={content} commands={[]} />);
    typeQuery("项目经历");
    expect(screen.getByText(GATEWAY)).toBeInTheDocument();
    expect(screen.getByText(PLATFORM)).toBeInTheDocument();
    typeQuery("不存在的词");
    expect(screen.getByText(t("outline.search.noMatch"))).toBeInTheDocument();
  });
});

describe("键盘命中导航与 Enter 定位", () => {
  it("↓ 选中第一条命中；再 ↓ 选第二条；Enter 定位并上报稳定 path", async () => {
    const content = makeContent();
    const onLocate = vi.fn();
    render(<Harness initial={content} commands={[]} onLocateSelection={onLocate} />);
    typeQuery("平台");
    expect(
      screen.getByText(t("outline.search.count", { current: 1, total: 1 })),
    ).toBeInTheDocument();
    typeQuery("支付");
    fireEvent.keyDown(searchInput(), { key: "ArrowDown" });
    expect(treeitem(entryKey(content, GATEWAY))?.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(searchInput(), { key: "Enter" });
    expect(onLocate).toHaveBeenCalledTimes(1);
    const [selection, path] = onLocate.mock.calls[0] as [OutlineSelection, string];
    expect(selection.kind).toBe("entry");
    expect(path).toBe(
      `projects.${entriesOf(content, "projects").findIndex((item) => item.name === GATEWAY)}`,
    );
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  });

  it("↑↓ 在两条命中间循环（第 1 条上一条回到最后一条）", () => {
    const content = makeContent();
    render(<Harness initial={content} commands={[]} />);
    typeQuery("报表");
    fireEvent.keyDown(searchInput(), { key: "ArrowDown" });
    const reportPoint = pointKey(content, PLATFORM, "离线报表");
    expect(treeitem(reportPoint)?.getAttribute("aria-selected")).toBe("true");
  });
});

describe("定位后的滚动位置恢复", () => {
  it("搜索聚焦时记住树位置；Esc 清空查询并把树滚回去", async () => {
    const content = makeContent();
    render(<Harness initial={content} commands={[]} />);
    const tree = screen.getByRole("tree", { name: t("outline.tree.label") });
    tree.scrollTop = 88;
    fireEvent.scroll(tree);
    fireEvent.focus(searchInput());
    typeQuery("平台");
    tree.scrollTop = 0;
    fireEvent.keyDown(searchInput(), { key: "Escape" });
    expect((searchInput() as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(tree.scrollTop).toBe(88));
  });

  it("纸面点进来的跳转可用「回到之前位置」复原（树滚动位置）", async () => {
    const content = makeContent();
    const commands: OutlineCommand[] = [];
    const utils = render(<Harness initial={content} commands={commands} pickTarget={null} />);
    const tree = screen.getByRole("tree", { name: t("outline.tree.label") });
    tree.scrollTop = 50;
    fireEvent.scroll(tree);
    utils.rerender(
      <Harness
        initial={content}
        commands={commands}
        pickTarget={{ path: `projects.1.name`, nonce: 7 }}
      />,
    );
    const restore = await screen.findByRole("button", { name: t("outline.search.restore") });
    tree.scrollTop = 0;
    fireEvent.click(restore);
    await waitFor(() => expect(tree.scrollTop).toBe(50));
    expect(screen.queryByRole("button", { name: t("outline.search.restore") })).toBeNull();
  });
});

describe("多选上报（W07 工具条契约）", () => {
  it("空格多选 → onMultiSelectionChange 收到 {id,label,meta}；句柄 clearMultiSelect 清空", () => {
    const content = makeContent();
    const onMulti = vi.fn();
    const apiRef: RefObject<OutlineMultiSelectionApi | null> = { current: null };
    render(
      <Harness
        initial={content}
        commands={[]}
        onMultiSelectionChange={onMulti}
        multiSelectionApiRef={apiRef}
      />,
    );
    const first = treeitem(entryKey(content, GATEWAY));
    const second = treeitem(entryKey(content, PLATFORM));
    if (!first || !second) throw new Error("entries missing");
    fireEvent.keyDown(first, { key: " " });
    fireEvent.keyDown(second, { key: " " });
    expect(onMulti).toHaveBeenCalled();
    const lastCall = onMulti.mock.calls[onMulti.mock.calls.length - 1][0] as OutlineMultiEntry[];
    expect(lastCall).toHaveLength(2);
    expect(lastCall[0]).toMatchObject({ field: "projects", meta: expect.any(String) });
    expect(lastCall.map((entry) => entry.label)).toEqual([GATEWAY, PLATFORM]);
    // 宿主句柄：工具条"取消选择"/应用后收起。
    expect(apiRef.current).not.toBeNull();
    act(() => apiRef.current?.clearMultiSelect());
    const cleared = onMulti.mock.calls[onMulti.mock.calls.length - 1][0] as unknown[];
    expect(cleared).toEqual([]);
  });
});
