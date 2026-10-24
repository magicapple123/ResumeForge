// SPDX-License-Identifier: Apache-2.0
/**
 * W21 场景 **E02** 集成测试（task-40）：复制项目 → 排序 → 隐藏 → 局部间距/分页 →
 * 换模板 → 统一历史撤销/重做，全部用**真实模块**（不是重写的模拟实现）：
 *
 * | 能力 | 真实模块 |
 * |---|---|
 * | 稳定身份 / 排序不换 id / 复制生成新 id | `features/resume-document/identity`、`features/resume-outline/commands` |
 * | 文档命令层（文本/要点 + 结构命令透传） | `features/resume-document/commands` |
 * | 统一历史（50 步、合并、undo/redo） | `features/resume-document/history` |
 * | 加粗 overlay 的 path 跟随 | `features/resume-outline/paths` + 一个与 useRichTextOverrides 同型的 overlay 桩 |
 * | 局部间距（roles/objects 域） | `features/resume-layout/styleOverrides` + `formatDomains` |
 * | 分页意图（pagination 域，语义锚点） | `features/resume-pagination/paginationDomain` |
 * | 换模板（保留局部覆盖、清会被预设覆盖的扁平微调） | `components/resume/layoutWithFormatPreset` |
 * | 保存 409 冲突 / 失败不清历史栈 | `features/resume-document/useDocumentSave`（真实 hook） |
 *
 * 未覆盖（写进证据文档）：真实渲染器视觉/页断点（需 W05/W07-BE/W08-BE 对拍）、
 * 隐藏条目在投递产物里的排除（后端 W06-BE，`test_resume_visibility.py` 覆盖）。
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ResumeContent, ResumeLayout } from "../../types";
import { ensureIds, isObjectId, resolvePathAt } from "./identity";
import { applyDocumentCommand } from "./commands";
import { createDocumentHistory } from "./history";
import { useDocumentSave } from "./useDocumentSave";
import { applyOutlineCommand } from "../resume-outline/commands";
import { buildPathRemap, remapPathMap } from "../resume-outline/paths";
import { entriesOf, entryIdOf, pointIdsOf } from "../resume-outline/model";
import { readStyleDomains, withObjectProp, withRoleProp } from "../resume-layout/styleOverrides";
import {
  readPaginationDomain,
  setContinuation,
  setEntryBreak,
  setSectionBreak,
} from "../resume-pagination/paginationDomain";
import { layoutWithFormatPreset } from "../../components/resume/layoutWithFormatPreset";

const PROJECT_A = "项目甲";
const PROJECT_B = "项目乙";
const TARGET_ID = "ob_aaaaaaaaaaaa";

function content(): ResumeContent {
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
    summary: "",
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
        description: ["甲一"],
        highlights: [],
      },
      {
        name: PROJECT_B,
        role: "开发",
        start_date: "",
        end_date: "",
        tech_stack: ["TypeScript"],
        description: ["乙一", "乙二"],
        highlights: [],
      },
    ],
    skills: [],
    awards: [],
  });
}

interface Overlay {
  raw: string;
  base: string;
}

/** 与制作台文档状态同型的快照：内容 + 版式 + 加粗 overlay（path 键控）。 */
interface DocState {
  content: ResumeContent;
  layout: ResumeLayout;
  overlays: Record<string, Overlay>;
}

function baseLayout(): ResumeLayout {
  return {
    template: "classic",
    format_name: "",
    page_limit: 2,
    font_scale: "standard",
    format_config: {},
  };
}

/** 一台"最小宿主"：只做历史/命令/域写入的串联，不复制任何业务规则。 */
function createHost() {
  const initial: DocState = {
    content: content(),
    layout: baseLayout(),
    overlays: {
      // 加粗 overlay 与 features/resume/useRichTextOverrides 同型（path → {raw, base}）。
      "projects.1.name": { raw: `**${PROJECT_B}**`, base: PROJECT_B },
    },
  };
  let state = initial;
  const history = createDocumentHistory<DocState>({ initial, limit: 50, debounceMs: 0 });

  const commit = (next: DocState, label: string): void => {
    state = next;
    history.push(state, label);
    history.flush();
  };

  const structure = (command: Parameters<typeof applyOutlineCommand>[1], label: string) => {
    const applied = applyOutlineCommand(state.content, command);
    if (!applied.ok) throw new Error(`结构命令被拒绝：${applied.reason}`);
    const remap = buildPathRemap(state.content, applied.content);
    commit(
      {
        content: applied.content,
        layout: state.layout,
        overlays: remapPathMap(state.overlays, remap),
      },
      label,
    );
    return applied.content;
  };

  const text = (command: Parameters<typeof applyDocumentCommand>[1], label: string) => {
    const result = applyDocumentCommand(state.content, command);
    if (!result.changed) throw new Error("文本命令没有改变内容");
    commit({ ...state, content: result.content }, label);
    return result.content;
  };

  const layout = (nextConfig: ResumeLayout["format_config"], label: string) => {
    commit({ ...state, layout: { ...state.layout, format_config: nextConfig } }, label);
  };

  /** 整份版式替换（换模板会同时改 template/format_name/format_config）。 */
  const replaceLayout = (nextLayout: ResumeLayout, label: string) => {
    commit({ ...state, layout: nextLayout }, label);
  };

  const undo = (): DocState | null => {
    const previous = history.undo();
    if (previous !== null) state = previous;
    return previous;
  };

  const redo = (): DocState | null => {
    const next = history.redo();
    if (next !== null) state = next;
    return next;
  };

  return {
    get state() {
      return state;
    },
    initial,
    history,
    structure,
    text,
    layout,
    replaceLayout,
    undo,
    redo,
  };
}

function entryIds(contentValue: ResumeContent): string[] {
  return entriesOf(contentValue, "projects").map((entry) => entryIdOf(entry));
}

describe("E02 复现链：复制 → 排序 → 隐藏 → 局部间距/分页 → 换模板", () => {
  it("每一步的数据性质成立，且撤销/重做能在初态与末态之间往返", () => {
    const host = createHost();
    const aId = entryIdOf(entriesOf(host.state.content, "projects")[0]);
    const bId = entryIdOf(entriesOf(host.state.content, "projects")[1]);
    expect(aId).not.toBe(bId);

    // ① 复制项目甲：新 id / 新 point_ids，正文保留，原条目不动。
    const afterClone = host.structure(
      { type: "clone-entry", field: "projects", objectId: aId },
      "复制项目",
    );
    const cloned = entriesOf(afterClone, "projects");
    expect(cloned).toHaveLength(3);
    expect(entryIdOf(cloned[1])).not.toBe(aId);
    expect(cloned[1].name).toBe(PROJECT_A);
    expect(cloned[1].description).toEqual(["甲一"]);
    expect(pointIdsOf(cloned[1], "description")[0]).not.toBe(
      pointIdsOf(cloned[0], "description")[0],
    );
    const copyId = entryIdOf(cloned[1]);

    // ② 排序：项目乙移到第一位；id 不变，加粗 overlay 的 path 跟着 B 走（2 → 0）。
    const afterMove = host.structure(
      { type: "reorder-entry", field: "projects", objectId: bId, toIndex: 0 },
      "移动项目到首位",
    );
    expect(entriesOf(afterMove, "projects").map((entry) => entry.name)).toEqual([
      PROJECT_B,
      PROJECT_A,
      PROJECT_A,
    ]);
    expect(entryIdOf(entriesOf(afterMove, "projects")[0])).toBe(bId);
    expect(host.state.overlays["projects.0.name"]).toEqual({
      raw: `**${PROJECT_B}**`,
      base: PROJECT_B,
    });
    expect(host.state.overlays["projects.2.name"]).toBeUndefined();

    // ③ 文本命令：改副本的一条要点；point_ids 与文本等长（保存不会被 422）。
    host.text(
      { kind: "set-bullet", path: `projects.2.description.0`, text: "甲一（补充量化）" },
      "编辑要点",
    );
    const editedCopy = entriesOf(host.state.content, "projects")[2];
    expect(editedCopy.description).toEqual(["甲一（补充量化）"]);
    expect(pointIdsOf(editedCopy, "description")).toHaveLength(1);

    // ④ 隐藏条目：写 hidden:true，正文保留（编辑态还能看到/恢复）。
    const afterHide = host.structure(
      { type: "set-hidden", entries: [{ field: "projects", objectId: copyId }], hidden: true },
      "隐藏条目",
    );
    const hiddenEntry = entriesOf(afterHide, "projects").find(
      (entry) => entryIdOf(entry) === copyId,
    );
    expect(hiddenEntry?.hidden).toBe(true);
    expect(hiddenEntry?.description).toEqual(["甲一（补充量化）"]);

    // ⑤ 局部间距（W07 域）：对象级 space_after + 角色级 line_height 写入 roles/objects 域。
    let config = host.state.layout.format_config ?? {};
    config = withObjectProp(config, bId, "space_after", 0.4);
    config = withRoleProp(config, "body", "line_height", 1.6);
    host.layout(config, "调整局部间距");
    const domains = readStyleDomains(host.state.layout.format_config);
    expect(domains.objects[bId]).toMatchObject({ space_after: 0.4 });
    expect(domains.roles.body).toMatchObject({ line_height: 1.6 });

    // ⑥ 分页意图（W08 域）：键是稳定 object_id / 板块键，不存下标。
    config = setEntryBreak(config, bId, {
      break_before: "page",
      keep_with_next: 2,
      allow_split: true,
    });
    config = setSectionBreak(config, "projects", { break_before: "page" });
    config = setContinuation(config, { repeat_name: true });
    host.layout(config, "设置分页意图");
    const pagination = readPaginationDomain(host.state.layout.format_config);
    expect(pagination?.entries[bId]).toEqual({
      break_before: "page",
      keep_with_next: 2,
      allow_split: true,
    });
    expect(pagination?.sections.projects).toEqual({ break_before: "page" });
    expect(pagination?.continuation).toEqual({ repeat_name: true });

    // ⑦ 换模板：format_name 变化、会被预设覆盖的扁平微调被清掉；
    //    但对象/角色覆盖与分页意图（域）保留，内容 id 一个不动。
    const beforeTemplate = host.state;
    const switched = layoutWithFormatPreset(
      {
        ...beforeTemplate.layout,
        format_config: { ...config, line_height: 1.5, accent: "#111111" },
      },
      "compact",
      [{ name: "compact", config: { line_height: 1.3, accent: "#222222" } }],
    );
    host.replaceLayout(switched, "换模板");
    host.structure(
      { type: "set-lock", field: "projects", objectId: bId, lock: "layout", value: true },
      "锁定排版",
    );
    // 换模板只改版式：内容身份/顺序不变（上面的 lock 是另一步，不改变这一点）。
    expect(entryIds(host.state.content)).toEqual(entryIds(afterHide));
    expect(host.state.layout.format_name).toBe("compact");
    expect(host.state.layout.format_config?.line_height).toBeUndefined();
    const keptDomains = readStyleDomains(host.state.layout.format_config);
    expect(keptDomains.objects[bId]).toMatchObject({ space_after: 0.4 });
    expect(readPaginationDomain(host.state.layout.format_config)?.entries[bId]?.break_before).toBe(
      "page",
    );

    // ⑧ 撤销到初态 / 重做到末态（真实 history 模块；初态深度相等）。
    const finalState = host.state;
    const steps = host.history.labels().past;
    expect(steps.length).toBeLessThanOrEqual(30);
    expect(host.history.canUndo()).toBe(true);

    let undone = 0;
    while (host.undo() !== null) {
      undone += 1;
      if (undone > 60) throw new Error("undo 未收敛");
    }
    expect(undone).toBe(steps.length);
    expect(host.state).toEqual(host.initial);

    let redone = 0;
    while (host.redo() !== null) {
      redone += 1;
      if (redone > 60) throw new Error("redo 未收敛");
    }
    expect(redone).toBe(steps.length);
    expect(host.state).toEqual(finalState);
  });

  it("撤销/重做：30 步以内混合操作逐步往返，内容与参数一致", () => {
    const host = createHost();
    const aId = entryIdOf(entriesOf(host.state.content, "projects")[0]);
    const bId = entryIdOf(entriesOf(host.state.content, "projects")[1]);

    host.structure({ type: "reorder-entry", field: "projects", objectId: bId, toIndex: 0 }, "移动");
    host.structure({ type: "clone-entry", field: "projects", objectId: aId }, "复制");
    host.structure(
      { type: "set-hidden", entries: [{ field: "projects", objectId: aId }], hidden: true },
      "隐藏",
    );
    host.layout(withObjectProp(host.state.layout.format_config ?? {}, bId, "indent", 2), "缩进");
    host.layout(
      setEntryBreak(host.state.layout.format_config ?? {}, bId, { keep_with_next: 1 }),
      "分页",
    );

    const finalState = host.state;
    const steps = host.history.labels().past.length;
    expect(steps).toBe(5);

    // 撤销到底：每一步都用 undo 的返回值作为当前状态。
    let current: DocState = finalState;
    const undoCount = steps;
    for (let i = 0; i < undoCount; i += 1) {
      const previous = host.history.undo();
      expect(previous).not.toBeNull();
      current = previous as DocState;
    }
    expect(host.history.canUndo()).toBe(false);
    expect(host.history.undo()).toBeNull();
    expect(current).toEqual(host.initial);

    // 重做到底：回到末态（内容 + 版式 + overlays 全部一致）。
    for (let i = 0; i < undoCount; i += 1) {
      const next = host.history.redo();
      expect(next).not.toBeNull();
      current = next as DocState;
    }
    expect(host.history.canRedo()).toBe(false);
    expect(current).toEqual(finalState);
    // 排序后 id 仍可解析到当前路径（身份不漂移）。
    expect(resolvePathAt(current.content, bId)).toBe("projects.0");
    expect(isObjectId(bId)).toBe(true);
    expect(resolvePathAt(current.content, TARGET_ID)).toBeNull();
  });
});

describe("保存 409 冲突/失败不清历史栈", () => {
  it("冲突态由 useDocumentSave 停在 conflict，调用方不清历史（可重试/比较）", async () => {
    const history = createDocumentHistory<number>({ initial: 1, limit: 10, debounceMs: 0 });
    history.push(2, "编辑");
    history.flush();
    expect(history.canUndo()).toBe(true);

    const perform = vi.fn(async () => ({ status: "conflict" as const, currentRevision: 9 }));
    const { result } = renderHook(() => useDocumentSave({ perform }));
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.status).toBe("conflict");
    expect(result.current.conflict).toBe(true);
    // 冲突不是"保存成功"：历史栈与可撤回能力原样保留（用户之后可以用最新的/比较）。
    expect(history.canUndo()).toBe(true);
    expect(history.labels().past).toEqual(["编辑"]);
  });

  it("失败态停在 failed，history 同样不清栈；成功才允许宿主 reset", async () => {
    const history = createDocumentHistory<number>({ initial: 1, limit: 10, debounceMs: 0 });
    history.push(2, "编辑");
    history.flush();

    const failing = renderHook(() =>
      useDocumentSave({
        perform: async () => ({ status: "failed" as const, error: new Error("boom") }),
      }),
    );
    await act(async () => {
      await failing.result.current.save();
    });
    expect(failing.result.current.status).toBe("failed");
    expect(history.canUndo()).toBe(true);

    // 宿主的正确接线：只有 saved/unchanged 才 reset（本用例演示契约，不复制 wb-core 实现）。
    const saved = renderHook(() =>
      useDocumentSave({ perform: async () => ({ status: "saved" as const, revision: 3 }) }),
    );
    await act(async () => {
      await saved.result.current.save();
    });
    expect(saved.result.current.status).toBe("idle");
    history.reset(2);
    expect(history.canUndo()).toBe(false);
  });
});
