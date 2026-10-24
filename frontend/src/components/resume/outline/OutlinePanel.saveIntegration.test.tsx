// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲 × 命令层/保存链路的**集成测试**（mock 版；真实后端 API 往返见交付证据里的
 * `runtime/w06-outline-verify/verify.py`）。
 *
 * 这里模拟 wb-core 在 W02/W03 的接线方式（已与 wb-core 对齐签名）：
 *
 * ```
 * onCommand(command, baseContent):
 *   next = applyOutlineCommand(baseContent, command)
 *   remap = buildPathRemap(baseContent, next)              // 旧下标 → 新下标
 *   overlays = remapPathMap(overlays, remap)               // 加粗 overlay 跟对象走
 *   annotations = remapAnnotationPaths(annotations, remap) // 事实来源 path 同步
 *   save(next)                                             // 既有条件写保存链路
 * ```
 *
 * 断言的是"保存出去的那份 JSON"而不是内存对象：真正会出问题的是序列化后的形状
 * （hidden/lock 字段在不在、id 有没有被换、overlay 的键是否还指向原内容）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
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
import {
  buildPathRemap,
  remapAnnotationPaths,
  remapPathMap,
  type PathRemap,
} from "../../../features/resume-outline/paths";
import type { OutlineCommand } from "../../../features/resume-outline/types";
import type { ResumeContent } from "../../../types/resume";
import OutlinePanel from "./OutlinePanel";

const PROJECT_A = "项目甲";
const PROJECT_B = "项目乙";
const POINT_B2 = "做了乙二";

interface Overlay {
  raw: string;
  base: string;
}

interface Annotation {
  path: string;
  origin: string;
  object_id?: string;
  point_id?: string;
}

interface Snapshot {
  saved: ResumeContent;
  overlays: Record<string, Overlay>;
  annotations: Annotation[];
}

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
        description: ["乙一", POINT_B2],
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

interface HarnessProps {
  initial: ResumeContent;
  seedOverlays?: Record<string, Overlay>;
  seedAnnotations?: Annotation[];
  onSnapshot: (snapshot: Snapshot) => void;
}

function Harness({ initial, seedOverlays, seedAnnotations, onSnapshot }: HarnessProps) {
  const [content, setContent] = useState<ResumeContent>(initial);
  // overlay/事实标注住在本组件里（模拟宿主状态）；ref 只在事件处理器里写。
  const overlaysRef = useRef<Record<string, Overlay>>(seedOverlays ?? {});
  const annotationsRef = useRef<Annotation[]>(seedAnnotations ?? []);
  const onCommand = (command: OutlineCommand, baseContent: ResumeContent) => {
    const result = applyOutlineCommand(baseContent, command);
    if (!result.ok) return;
    const next = result.content;
    const remap: PathRemap = buildPathRemap(baseContent, next);
    overlaysRef.current = remapPathMap(overlaysRef.current, remap);
    annotationsRef.current = remapAnnotationPaths(annotationsRef.current, remap);
    // 模拟保存链路的序列化边界：保存/读回的是 JSON 形状，不是内存引用。
    const saved = JSON.parse(JSON.stringify(next)) as ResumeContent;
    setContent(next);
    onSnapshot({ saved, overlays: overlaysRef.current, annotations: annotationsRef.current });
  };
  return (
    <AntdApp>
      <OutlinePanel content={content} onCommand={onCommand} />
    </AntdApp>
  );
}

function renderWithHarness(
  initial: ResumeContent,
  seed: { overlays?: Record<string, Overlay>; annotations?: Annotation[] } = {},
): Snapshot[] {
  const snapshots: Snapshot[] = [];
  render(
    <Harness
      initial={initial}
      seedOverlays={seed.overlays}
      seedAnnotations={seed.annotations}
      onSnapshot={(snapshot) => snapshots.push(snapshot)}
    />,
  );
  return snapshots;
}

function sortHandle(name: string): HTMLElement {
  return screen.getByRole("button", { name: t("outline.sort.handle", { name }) });
}

function moveSecondProjectToFirst(): void {
  const handle = sortHandle(PROJECT_B);
  fireEvent.focus(handle);
  fireEvent.keyDown(handle, { key: "Enter" });
  fireEvent.keyDown(handle, { key: "ArrowUp" });
  fireEvent.keyDown(handle, { key: "Enter" });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("排序 → 保存 → 读回（含 overlay/事实标注重映射）", () => {
  it("保存 JSON 里顺序变了、id 没变；加粗与来源跟着原对象走", () => {
    const initial = makeContent();
    const projectBId = idOf(initial, PROJECT_B);
    const pointB2Id = pointIdsOf(entriesOf(initial, "projects")[1], "description")[1];
    const snapshots = renderWithHarness(initial, {
      overlays: {
        "projects.1.name": { raw: `**${PROJECT_B}**`, base: PROJECT_B },
        "projects.1.description.1": { raw: `**${POINT_B2}**`, base: POINT_B2 },
      },
      annotations: [
        {
          path: "projects.1.description.1",
          origin: "user_added",
          object_id: projectBId,
          point_id: pointB2Id,
        },
      ],
    });

    moveSecondProjectToFirst();

    // ① 保存出去的 JSON：顺序变了，id 与内容一起走。
    expect(snapshots).toHaveLength(1);
    const saved = snapshots[0].saved;
    expect(entriesOf(saved, "projects").map((entry) => entry.name)).toEqual([PROJECT_B, PROJECT_A]);
    expect(entryIdOf(entriesOf(saved, "projects")[0])).toBe(projectBId);
    expect(entriesOf(saved, "projects")[0].description).toEqual(["乙一", POINT_B2]);

    // ② 加粗 overlay 的键跟到新下标，且 base 与**新内容**一致（不会盖到项目甲上）。
    expect(snapshots[0].overlays["projects.0.name"]?.base).toBe(PROJECT_B);
    expect(snapshots[0].overlays["projects.0.description.1"]?.base).toBe(POINT_B2);
    expect(snapshots[0].overlays["projects.1.name"]).toBeUndefined();
    // ③ 事实标注 path 同步，稳定 id 不动。
    expect(snapshots[0].annotations[0]).toMatchObject({
      path: "projects.0.description.1",
      object_id: projectBId,
      point_id: pointB2Id,
    });

    // ④ 读回（GET 语义）：JSON 落库再读，id 原样，重新构建大纲仍是同一个对象。
    const reloaded = ensureIds(JSON.parse(JSON.stringify(saved)) as ResumeContent);
    expect(entryIdOf(entriesOf(reloaded, "projects")[0])).toBe(projectBId);
    expect(
      buildOutline(reloaded).sections.find((section) => section.field === "projects")?.entries[0]
        .title,
    ).toBe(PROJECT_B);
    // ensureIds 幂等：读回再补齐不会换 id（W01 的"保存一次不换一次 id"）。
    expect(ensureIds(reloaded)).toEqual(reloaded);
  });
});

describe("隐藏/锁定 → 保存 JSON 形状", () => {
  it("隐藏写 true；恢复显示后 JSON 里没有 hidden 键（旧内容指纹不变）", () => {
    const initial = makeContent();
    const snapshots = renderWithHarness(initial);
    const entry = treeitem(keyOf(initial, PROJECT_B));
    fireEvent.click(entry.querySelector(".resume-outline-main") as HTMLElement);
    const hiddenSwitch = () =>
      screen.getByRole("switch", { name: t("outline.inspector.toggleHidden") });

    fireEvent.click(hiddenSwitch());
    expect(snapshots).toHaveLength(1);
    const hiddenEntry = entriesOf(snapshots[0].saved, "projects").find(
      (item) => item.name === PROJECT_B,
    );
    expect(hiddenEntry?.hidden).toBe(true);
    // 编辑态正文保留：隐藏不删内容。
    expect(hiddenEntry?.description).toEqual(["乙一", POINT_B2]);

    fireEvent.click(hiddenSwitch());
    expect(snapshots).toHaveLength(2);
    const restoredEntry = entriesOf(snapshots[1].saved, "projects").find(
      (item) => item.name === PROJECT_B,
    );
    expect(restoredEntry).not.toHaveProperty("hidden");
    expect(JSON.stringify(snapshots[1].saved)).not.toContain('"hidden":false');
  });

  it("锁定内容/排版分别写入 lock_content / lock_layout，且不影响正文", () => {
    const initial = makeContent();
    const snapshots = renderWithHarness(initial);
    fireEvent.click(
      treeitem(keyOf(initial, PROJECT_A)).querySelector(".resume-outline-main") as HTMLElement,
    );
    fireEvent.click(screen.getByRole("switch", { name: t("outline.inspector.toggleContent") }));
    fireEvent.click(screen.getByRole("switch", { name: t("outline.inspector.toggleLayout") }));
    const saved = snapshots[snapshots.length - 1].saved;
    const locked = entriesOf(saved, "projects").find((item) => item.name === PROJECT_A);
    expect(locked?.lock_content).toBe(true);
    expect(locked?.lock_layout).toBe(true);
    expect(locked?.description).toEqual(["甲一"]);
  });
});
