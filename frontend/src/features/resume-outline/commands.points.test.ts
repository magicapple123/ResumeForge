// SPDX-License-Identifier: Apache-2.0
/** W06 要点级隐藏（set-hidden-points）与复制（clone-point）的命令层性质。 */
import { describe, expect, it } from "vitest";
import { applyOutlineCommand } from "./commands";
import { ensureIds } from "../resume-document/identity";
import { buildOutline, entriesOf, pointIdsOf } from "./model";
import type { OutlineCommand } from "./types";
import type { ResumeContent } from "../../types/resume";

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
        tech_stack: ["TypeScript"],
        description: ["要点一", "要点二"],
        highlights: ["亮点一"],
      },
    ],
    skills: [],
    awards: [],
  });
}

function project(content: ResumeContent) {
  return entriesOf(content, "projects")[0];
}

function pointIdAt(content: ResumeContent, pointField: string, index: number): string {
  return pointIdsOf(project(content), pointField)[index];
}

function entryRef(content: ResumeContent) {
  return { field: "projects" as const, objectId: String(project(content).id) };
}

describe("set-hidden-points（要点级显隐）", () => {
  it("隐藏单条要点：写 hidden_points（只登记 point id），内容是新的、原对象不变", () => {
    const content = makeContent();
    const pointId = pointIdAt(content, "description", 1);
    const command: OutlineCommand = {
      type: "set-hidden-points",
      ...entryRef(content),
      points: [{ pointField: "description", pointId }],
      hidden: true,
    };
    const result = applyOutlineCommand(content, command);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(project(result.content).hidden_points).toEqual([pointId]);
    // 条目级 hidden 不被顺带设置（两种显隐不是一回事）。
    expect(project(result.content)).not.toHaveProperty("hidden");
    // 入参不被修改。
    expect(project(content)).not.toHaveProperty("hidden_points");
  });

  it("取消隐藏 = 删键（不写 hidden_points: []，旧记录内容指纹不变）", () => {
    const content = makeContent();
    const pointId = pointIdAt(content, "description", 0);
    const hide = applyOutlineCommand(content, {
      type: "set-hidden-points",
      ...entryRef(content),
      points: [{ pointField: "description", pointId }],
      hidden: true,
    });
    expect(hide.ok).toBe(true);
    if (!hide.ok) return;
    const show = applyOutlineCommand(hide.content, {
      type: "set-hidden-points",
      ...entryRef(hide.content),
      points: [{ pointField: "description", pointId }],
      hidden: false,
    });
    expect(show.ok).toBe(true);
    if (!show.ok) return;
    expect(show.changed).toBe(true);
    expect(project(show.content)).not.toHaveProperty("hidden_points");
  });

  it("幂等：已经是目标状态时 changed=false 且内容引用不变", () => {
    const content = makeContent();
    const pointId = pointIdAt(content, "description", 0);
    const hidden = applyOutlineCommand(content, {
      type: "set-hidden-points",
      ...entryRef(content),
      points: [{ pointField: "description", pointId }],
      hidden: true,
    });
    if (!hidden.ok) throw new Error("hide failed");
    const again = applyOutlineCommand(hidden.content, {
      type: "set-hidden-points",
      ...entryRef(content),
      points: [{ pointField: "description", pointId }],
      hidden: true,
    });
    expect(again.ok && again.changed === false && again.content === hidden.content).toBe(true);
  });

  it("未知/空 point id → not-found；旧的非法值不会写进 hidden_points", () => {
    const content = makeContent();
    const missing = applyOutlineCommand(content, {
      type: "set-hidden-points",
      ...entryRef(content),
      points: [{ pointField: "description", pointId: "ob_does_not_exist" }],
      hidden: true,
    });
    expect(missing).toEqual({ ok: false, reason: "not-found" });
    const empty = applyOutlineCommand(content, {
      type: "set-hidden-points",
      ...entryRef(content),
      points: [{ pointField: "description", pointId: "" }],
      hidden: true,
    });
    expect(empty).toEqual({ ok: false, reason: "not-found" });
  });

  it("锁正文/锁排版都不阻止要点显隐（可见性操作）", () => {
    const content = makeContent();
    const pointId = pointIdAt(content, "description", 0);
    const locked = applyOutlineCommand(content, {
      type: "set-lock",
      ...entryRef(content),
      lock: "content",
      value: true,
    });
    if (!locked.ok) throw new Error("lock failed");
    const result = applyOutlineCommand(locked.content, {
      type: "set-hidden-points",
      ...entryRef(locked.content),
      points: [{ pointField: "description", pointId }],
      hidden: true,
    });
    expect(result.ok).toBe(true);
  });
});

describe("clone-point（复制要点）", () => {
  it("复制生成新 point id、相邻插入，文本数组与 point_ids 同步变长", () => {
    const content = makeContent();
    const pointId = pointIdAt(content, "description", 0);
    const result = applyOutlineCommand(content, {
      type: "clone-point",
      ...entryRef(content),
      pointField: "description",
      pointId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = project(result.content);
    expect((entry.description as string[]).slice(0, 3)).toEqual(["要点一", "要点一", "要点二"]);
    const ids = pointIdsOf(entry, "description");
    // 原来两条要点 → 复制后三条（文本数组与 point_ids 同步变长）。
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe(pointId);
    expect(ids[1]).not.toBe(pointId);
    // highlights 不受影响（只复制指定的那个数组）。
    expect(pointIdsOf(entry, "highlights")).toHaveLength(1);
  });

  it("复制被隐藏的要点：副本沿用隐藏状态（与复制条目一致）", () => {
    const content = makeContent();
    const pointId = pointIdAt(content, "description", 0);
    const hidden = applyOutlineCommand(content, {
      type: "set-hidden-points",
      ...entryRef(content),
      points: [{ pointField: "description", pointId }],
      hidden: true,
    });
    if (!hidden.ok) throw new Error("hide failed");
    const result = applyOutlineCommand(hidden.content, {
      type: "clone-point",
      ...entryRef(hidden.content),
      pointField: "description",
      pointId,
    });
    if (!result.ok) throw new Error("clone failed");
    const clonedId = pointIdsOf(project(result.content), "description")[1];
    expect(project(result.content).hidden_points).toEqual([pointId, clonedId]);
  });

  it("锁正文阻止复制要点；未知要点/字段 → not-found", () => {
    const content = makeContent();
    const pointId = pointIdAt(content, "description", 0);
    const locked = applyOutlineCommand(content, {
      type: "set-lock",
      ...entryRef(content),
      lock: "content",
      value: true,
    });
    if (!locked.ok) throw new Error("lock failed");
    expect(
      applyOutlineCommand(locked.content, {
        type: "clone-point",
        ...entryRef(locked.content),
        pointField: "description",
        pointId,
      }),
    ).toEqual({ ok: false, reason: "locked-content" });
    expect(
      applyOutlineCommand(content, {
        type: "clone-point",
        ...entryRef(content),
        pointField: "description",
        pointId: "ob_unknown",
      }),
    ).toEqual({ ok: false, reason: "not-found" });
    expect(
      applyOutlineCommand(content, {
        type: "clone-point",
        ...entryRef(content),
        pointField: "not_a_point_field",
        pointId,
      }),
    ).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("buildOutline 读取要点级隐藏状态", () => {
  it("hidden_points 里的 point id 在模型里标 hidden=true", () => {
    const content = makeContent();
    const pointId = pointIdAt(content, "description", 1);
    const hidden = applyOutlineCommand(content, {
      type: "set-hidden-points",
      ...entryRef(content),
      points: [{ pointField: "description", pointId }],
      hidden: true,
    });
    if (!hidden.ok) throw new Error("hide failed");
    const section = buildOutline(hidden.content).sections.find((item) => item.field === "projects");
    const points =
      section?.entries[0].points.filter((point) => point.pointField === "description") ?? [];
    expect(points.map((point) => point.hidden)).toEqual([false, true]);
  });
});
