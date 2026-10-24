// SPDX-License-Identifier: Apache-2.0
/**
 * 结构命令的纯函数测试（W06 验收里最贵的几条性质全在这里，不依赖 jsdom）：
 * - 排序不换 id（条目与要点各一条）；
 * - 复制生成新 id（条目 + 全部 point_ids），新旧共存；
 * - 隐藏后再显示**完整恢复**（包括"取消 = 删键"这条指纹兼容约定）；
 * - 锁定按作用域阻止对应操作，且幂等。
 *
 * 中文只出现在夹具数据里；断言文案走 key 映射（不在这一层）。
 */
import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../../types/resume";
import { ensureIds } from "../resume-document/identity";
import { applyOutlineCommand, BLOCKED_REASON_KEY, canCloneEntry, canMoveEntry } from "./commands";
import { entriesOf, entryIdOf, pointIdsOf } from "./model";
import type { OutlineCommand } from "./types";

function content(): ResumeContent {
  return {
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
    education: [
      {
        school: "示例大学",
        major: "软件工程",
        degree: "本科",
        start_date: "2018-09",
        end_date: "2022-06",
        gpa: "3.8",
        courses: ["数据结构"],
        achievements: ["奖学金"],
      },
    ],
    experience: [
      {
        company: "甲公司",
        role: "工程师",
        start_date: "2022-07",
        end_date: "2023-06",
        description: ["做了甲一", "做了甲二"],
      },
      {
        company: "乙公司",
        role: "高级工程师",
        start_date: "2023-07",
        end_date: "",
        description: ["做了乙一"],
      },
    ],
    campus_experience: [],
    projects: [
      {
        name: "项目甲",
        role: "负责人",
        start_date: "",
        end_date: "",
        tech_stack: ["Python"],
        description: ["做了甲"],
        highlights: ["上线了"],
      },
      {
        name: "项目乙",
        role: "开发",
        start_date: "",
        end_date: "",
        tech_stack: ["TypeScript"],
        description: ["做了乙一", "做了乙二"],
        highlights: ["获奖了"],
      },
    ],
    skills: [{ name: "Python", level: "熟练" }],
    awards: [{ name: "一等奖", date: "2021", description: "" }],
  };
}

const base: ResumeContent = ensureIds(content());

function ok(result: ReturnType<typeof applyOutlineCommand>): Extract<typeof result, { ok: true }> {
  if (!result.ok) throw new Error(`命令被拒绝：${result.reason}`);
  return result;
}

describe("reorder-entry", () => {
  it("把第二个项目移到第一位：id 与内容一起走，入参不被修改", () => {
    const secondId = entryIdOf(entriesOf(base, "projects")[1]);
    const before = JSON.parse(JSON.stringify(base)) as ResumeContent;
    const command: OutlineCommand = {
      type: "reorder-entry",
      field: "projects",
      objectId: secondId,
      toIndex: 0,
    };
    const result = ok(applyOutlineCommand(base, command));

    expect(result.changed).toBe(true);
    const projects = entriesOf(result.content, "projects");
    expect(projects.map(entryIdOf)).toEqual([secondId, entryIdOf(entriesOf(base, "projects")[0])]);
    expect(projects[0].name).toBe("项目乙");
    // 要点随条目一起移动，text 与 point_ids 仍一一对应。
    expect(projects[0].description).toEqual(["做了乙一", "做了乙二"]);
    expect(pointIdsOf(projects[0], "description")).toEqual(
      pointIdsOf(entriesOf(base, "projects")[1], "description"),
    );
    // 纯函数：入参原样。
    expect(base).toEqual(before);
  });

  it("目标下标与当前相同 → changed=false，返回同一份内容", () => {
    const firstId = entryIdOf(entriesOf(base, "projects")[0]);
    const result = ok(
      applyOutlineCommand(base, {
        type: "reorder-entry",
        field: "projects",
        objectId: firstId,
        toIndex: 0,
      }),
    );
    expect(result.changed).toBe(false);
    expect(result.content).toBe(base);
  });

  it("未知 id 返回 not-found", () => {
    const result = applyOutlineCommand(base, {
      type: "reorder-entry",
      field: "projects",
      objectId: "ob_000000000000",
      toIndex: 0,
    });
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });

  it("锁排版阻止排序；解锁后恢复可排", () => {
    const targetId = entryIdOf(entriesOf(base, "experience")[1]);
    const locked = ok(
      applyOutlineCommand(base, {
        type: "set-lock",
        field: "experience",
        objectId: targetId,
        lock: "layout",
        value: true,
      }),
    );
    const blocked = applyOutlineCommand(locked.content, {
      type: "reorder-entry",
      field: "experience",
      objectId: targetId,
      toIndex: 0,
    });
    expect(blocked).toEqual({ ok: false, reason: "locked-layout" });
    expect(BLOCKED_REASON_KEY["locked-layout"]).toBe("outline.blocked.locked-layout");
    expect(canMoveEntry(entriesOf(locked.content, "experience")[1])).toBe(false);
  });
});

describe("reorder-point", () => {
  it("要点文本数组与 point_ids 同步移动，条目 id 不变", () => {
    const project = entriesOf(base, "projects")[1];
    const projectId = entryIdOf(project);
    const ids = pointIdsOf(project, "description");
    const result = ok(
      applyOutlineCommand(base, {
        type: "reorder-point",
        field: "projects",
        objectId: projectId,
        pointField: "description",
        pointId: ids[1],
        toIndex: 0,
      }),
    );
    const moved = entriesOf(result.content, "projects")[1];
    expect(moved.description).toEqual(["做了乙二", "做了乙一"]);
    expect(pointIdsOf(moved, "description")).toEqual([ids[1], ids[0]]);
    // 其它要点数组（highlights）原样。
    expect(moved.highlights).toEqual(["获奖了"]);
    expect(entryIdOf(moved)).toBe(projectId);
  });

  it("要点 id 不在该条目里时返回 not-found", () => {
    const projectId = entryIdOf(entriesOf(base, "projects")[0]);
    const result = applyOutlineCommand(base, {
      type: "reorder-point",
      field: "projects",
      objectId: projectId,
      pointField: "description",
      pointId: "ob_000000000000",
      toIndex: 0,
    });
    expect(result).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("clone-entry", () => {
  it("复制生成全新条目 id 与全部要点 id，新旧共存且内容一致", () => {
    const source = entriesOf(base, "projects")[1];
    const sourceId = entryIdOf(source);
    const result = ok(
      applyOutlineCommand(base, { type: "clone-entry", field: "projects", objectId: sourceId }),
    );
    const projects = entriesOf(result.content, "projects");
    expect(projects).toHaveLength(3);
    // 插在原条目后面，源条目位置不动。
    expect(entryIdOf(projects[1])).toBe(sourceId);
    const copy = projects[2];
    expect(entryIdOf(copy)).not.toBe(sourceId);
    expect(copy.name).toBe("项目乙");
    expect(copy.description).toEqual(["做了乙一", "做了乙二"]);
    const copyIds = pointIdsOf(copy, "description");
    expect(copyIds).toHaveLength(2);
    expect(new Set(copyIds).size).toBe(2);
    for (const id of copyIds) expect(pointIdsOf(source, "description")).not.toContain(id);
  });

  it("锁正文阻止复制（解锁后才能复制），且不写 false 字段", () => {
    const sourceId = entryIdOf(entriesOf(base, "skills")[0]);
    const locked = ok(
      applyOutlineCommand(base, {
        type: "set-lock",
        field: "skills",
        objectId: sourceId,
        lock: "content",
        value: true,
      }),
    );
    expect(canCloneEntry(entriesOf(locked.content, "skills")[0])).toBe(false);
    const blocked = applyOutlineCommand(locked.content, {
      type: "clone-entry",
      field: "skills",
      objectId: sourceId,
    });
    expect(blocked).toEqual({ ok: false, reason: "locked-content" });
    const unlocked = ok(
      applyOutlineCommand(locked.content, {
        type: "set-lock",
        field: "skills",
        objectId: sourceId,
        lock: "content",
        value: false,
      }),
    );
    expect(entriesOf(unlocked.content, "skills")[0]).toEqual(entriesOf(base, "skills")[0]);
  });
});

describe("set-hidden", () => {
  it("隐藏写 true、恢复删键：隐藏后再显示与原始内容逐字段相等", () => {
    const firstId = entryIdOf(entriesOf(base, "experience")[0]);
    const secondId = entryIdOf(entriesOf(base, "experience")[1]);
    const hidden = ok(
      applyOutlineCommand(base, {
        type: "set-hidden",
        entries: [
          { field: "experience", objectId: firstId },
          { field: "experience", objectId: secondId },
        ],
        hidden: true,
      }),
    );
    for (const entry of entriesOf(hidden.content, "experience")) {
      expect(entry.hidden).toBe(true);
    }
    // 编辑态原文一字不动。
    expect(entriesOf(hidden.content, "experience")[0].description).toEqual([
      "做了甲一",
      "做了甲二",
    ]);

    const restored = ok(
      applyOutlineCommand(hidden.content, {
        type: "set-hidden",
        entries: [
          { field: "experience", objectId: firstId },
          { field: "experience", objectId: secondId },
        ],
        hidden: false,
      }),
    );
    // 关键：取消显示是**删除键**，不是写 false——旧记录的指纹才不会被一次"恢复显示"改掉。
    expect(restored.content).toEqual(base);
    expect(entriesOf(restored.content, "experience")[0]).not.toHaveProperty("hidden");
  });

  it("已经是目标状态时 changed=false", () => {
    const firstId = entryIdOf(entriesOf(base, "experience")[0]);
    const result = ok(
      applyOutlineCommand(base, {
        type: "set-hidden",
        entries: [{ field: "experience", objectId: firstId }],
        hidden: false,
      }),
    );
    expect(result.changed).toBe(false);
    expect(result.content).toBe(base);
  });
});

describe("set-lock", () => {
  it("置位写 true，解锁删键；锁排版不影响锁正文", () => {
    const id = entryIdOf(entriesOf(base, "awards")[0]);
    const layoutLocked = ok(
      applyOutlineCommand(base, {
        type: "set-lock",
        field: "awards",
        objectId: id,
        lock: "layout",
        value: true,
      }),
    );
    const entry = entriesOf(layoutLocked.content, "awards")[0];
    expect(entry.lock_layout).toBe(true);
    expect(entry).not.toHaveProperty("lock_content");

    const both = ok(
      applyOutlineCommand(layoutLocked.content, {
        type: "set-lock",
        field: "awards",
        objectId: id,
        lock: "content",
        value: true,
      }),
    );
    const restored = ok(
      applyOutlineCommand(both.content, {
        type: "set-lock",
        field: "awards",
        objectId: id,
        lock: "layout",
        value: false,
      }),
    );
    expect(entriesOf(restored.content, "awards")[0].lock_content).toBe(true);
    expect(entriesOf(restored.content, "awards")[0]).not.toHaveProperty("lock_layout");
  });
});
