// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲树视图逻辑测试：可见顺序、排序预览、会话 → 命令。
 *
 * 最贵的一条断言是"预览顺序 === 命令执行后的真实顺序"：如果两处算法分叉，用户按 Enter
 * 确认时看到的顺序会跳一下——这正是"键盘排序看起来能用、其实不可信"的形态。
 */
import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../../../types/resume";
import { ensureIds } from "../../../features/resume-document/identity";
import { applyOutlineCommand } from "../../../features/resume-outline/commands";
import {
  buildOutline,
  entriesOf,
  entryIdOf,
  pointIdsOf,
  selectionKey,
} from "../../../features/resume-outline/model";
import type { OutlineSelection } from "../../../features/resume-outline/types";
import {
  entrySortSession,
  pointSortSession,
  previewModel,
  selectionEntry,
  selectionForTreeKey,
  sortSessionCommand,
  sortSessionForSelection,
  treeKeyForSelection,
  visibleTreeKeys,
} from "./outlineTree";

function content(): ResumeContent {
  return {
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
        tech_stack: ["Python"],
        description: ["甲一", "甲二", "甲三"],
        highlights: [],
      },
      {
        name: "项目乙",
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: ["TypeScript"],
        description: ["乙一", "乙二"],
        highlights: [],
      },
    ],
    skills: [],
    awards: [],
  };
}

const ready = ensureIds(content());
const model = buildOutline(ready);
const projectA = entriesOf(ready, "projects")[0];
const projectB = entriesOf(ready, "projects")[1];
const projectAId = entryIdOf(projectA);
const projectBId = entryIdOf(projectB);

describe("visibleTreeKeys", () => {
  it("分组默认只显示标题；展开分组才出现条目，再展开条目才出现要点", () => {
    expect(visibleTreeKeys(model, new Set(), new Set())).toEqual([
      "personal",
      "section:education",
      "section:experience",
      "section:campus_experience",
      "section:projects",
      "section:skills",
      "section:awards",
    ]);
    const sections = new Set(["projects"]);
    expect(visibleTreeKeys(model, sections, new Set())).toEqual([
      "personal",
      "section:education",
      "section:experience",
      "section:campus_experience",
      "section:projects",
      `entry:projects:${projectAId}`,
      `entry:projects:${projectBId}`,
      "section:skills",
      "section:awards",
    ]);
    const entries = new Set([`entry:projects:${projectBId}`]);
    const keys = visibleTreeKeys(model, sections, entries);
    expect(keys).toContain(
      `point:projects:${projectBId}:description:${pointIdsOf(projectB, "description")[0]}`,
    );
    // 9 个分组/条目节点 + 项目乙的 3 条要点（技术栈 1 + 描述 2）。
    expect(keys).toHaveLength(12);
  });

  it("缺身份的旧条目不进树（不拿空 key 冒充节点）", () => {
    const legacy = buildOutline(content());
    const keys = visibleTreeKeys(legacy, new Set(["projects"]), new Set());
    expect(keys).toEqual([
      "personal",
      "section:education",
      "section:experience",
      "section:campus_experience",
      "section:projects",
      "section:skills",
      "section:awards",
    ]);
  });
});

describe("排序会话与预览", () => {
  it("条目会话：预览顺序与命令执行结果一致，且 id 不换", () => {
    const selection: OutlineSelection = { kind: "entry", field: "projects", objectId: projectBId };
    const session = entrySortSession(model, selection);
    expect(session).toMatchObject({ kind: "entry", startIndex: 1, currentIndex: 1, total: 2 });
    // 第一次 ArrowUp：预览把项目乙移到第 1 位。
    const preview = previewModel(model, { ...session!, currentIndex: 0 });
    const previewed =
      preview.sections.find((section) => section.field === "projects")?.entries ?? [];
    expect(previewed.map((entry) => entry.title)).toEqual(["项目乙", "项目甲"]);
    expect(previewed.map((entry) => entry.objectId)).toEqual([projectBId, projectAId]);

    // Enter 确认：命令执行后的真实顺序必须与预览一致。
    const result = applyOutlineCommand(ready, sortSessionCommand({ ...session!, currentIndex: 0 }));
    if (!result.ok) throw new Error(result.reason);
    const committed =
      buildOutline(result.content).sections.find((section) => section.field === "projects")
        ?.entries ?? [];
    expect(committed.map((entry) => entry.objectId)).toEqual(
      previewed.map((entry) => entry.objectId),
    );
    expect(committed.map((entry) => entry.title)).toEqual(previewed.map((entry) => entry.title));
  });

  it("要点会话：下标是 pointField 分组内的，预览不跨语义数组搬内容", () => {
    const ids = pointIdsOf(projectA, "description");
    const selection: OutlineSelection = {
      kind: "point",
      field: "projects",
      objectId: projectAId,
      pointField: "description",
      pointId: ids[2],
    };
    const session = pointSortSession(model, selection);
    expect(session).toMatchObject({ kind: "point", startIndex: 2, currentIndex: 2, total: 3 });
    const preview = previewModel(model, { ...session!, currentIndex: 0 });
    const entry = preview.sections
      .find((section) => section.field === "projects")
      ?.entries.find((item) => item.objectId === projectAId);
    // 技术栈分组不参与要点排序，但仍在列表最前（字段声明顺序）。
    expect(entry?.points.map((point) => point.text)).toEqual(["Python", "甲三", "甲一", "甲二"]);
    // tech_stack 分组不参与排序（项目甲只有一条技术栈，排在 description 前面）。
    expect(entry?.points.map((point) => point.pointField)).toEqual([
      "tech_stack",
      "description",
      "description",
      "description",
    ]);
    // 重新编号，供行号展示。
    expect(
      entry?.points
        .filter((point) => point.pointField === "description")
        .map((point) => point.index),
    ).toEqual([0, 1, 2]);
  });

  it("不可排序的对象返回 null：个人信息、单条目分组、找不到的 id", () => {
    expect(sortSessionForSelection(model, { kind: "personal" })).toBeNull();
    expect(
      entrySortSession(model, {
        kind: "entry",
        field: "projects",
        objectId: "ob_000000000000",
      }),
    ).toBeNull();
    // 项目乙只有 2 条要点，可排；给一条不存在的要点 id 应返回 null。
    expect(
      pointSortSession(model, {
        kind: "point",
        field: "projects",
        objectId: projectBId,
        pointField: "description",
        pointId: "ob_000000000000",
      }),
    ).toBeNull();
    expect(sortSessionForSelection(model, null)).toBeNull();
  });
});

describe("选择与树键", () => {
  it("选择 ↔ 树键一一对应；selectionForTreeKey 能还原选择", () => {
    const entrySelection: OutlineSelection = {
      kind: "entry",
      field: "projects",
      objectId: projectAId,
    };
    const key = treeKeyForSelection(entrySelection);
    expect(key).toBe(`entry:projects:${projectAId}`);
    const restored = selectionForTreeKey(key);
    expect(selectionKey(restored)).toBe(selectionKey(entrySelection));
    expect(selectionEntry(model, restored)?.title).toBe("项目甲");

    const ids = pointIdsOf(projectA, "description");
    const pointSelection: OutlineSelection = {
      kind: "point",
      field: "projects",
      objectId: projectAId,
      pointField: "description",
      pointId: ids[0],
    };
    const pointKey = treeKeyForSelection(pointSelection);
    expect(selectionForTreeKey(pointKey)).toEqual(pointSelection);
    expect(selectionEntry(model, pointSelection)?.title).toBe("项目甲");

    expect(treeKeyForSelection({ kind: "personal" })).toBe("personal");
    expect(selectionForTreeKey("section:projects")).toBeNull();
    expect(selectionEntry(model, { kind: "personal" })).toBeNull();
  });
});
