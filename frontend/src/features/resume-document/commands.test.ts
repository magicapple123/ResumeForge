// SPDX-License-Identifier: Apache-2.0
/** W03：文档命令层——纯函数、不可变、id/要点伴随数组同步。 */
import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../../types/resume";
import { applyDocumentCommand, bumpsRevision, mergeKeyOf } from "./commands";
import { ensureIds } from "./identity";

function content(): ResumeContent {
  return {
    photo: "",
    name: "Alex",
    gender: "",
    birth_year: "",
    phone: "",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "Backend",
    summary: "",
    education: [],
    experience: [
      {
        id: "ob_entry0001",
        company: "A",
        role: "Dev",
        start_date: "",
        end_date: "",
        description: ["one", "two"],
        point_ids: { description: ["ob_point0001", "ob_point0002"] },
      },
      {
        id: "ob_entry0002",
        company: "B",
        role: "Dev2",
        start_date: "",
        end_date: "",
        description: ["x"],
        point_ids: { description: ["ob_point0003"] },
      },
    ],
    campus_experience: [],
    projects: [],
    skills: [],
    awards: [],
  } as ResumeContent;
}

describe("commands · 文本", () => {
  it("set-text：不可变写入；同值写入是 no-op", () => {
    const before = content();
    const applied = applyDocumentCommand(before, { kind: "set-text", path: "name", text: "Bob" });
    expect(applied.changed).toBe(true);
    expect(applied.content.name).toBe("Bob");
    // 原对象一个字节都不动（历史快照依赖不可变）。
    expect(before.name).toBe("Alex");

    const again = applyDocumentCommand(applied.content, {
      kind: "set-text",
      path: "name",
      text: "Bob",
    });
    expect(again.changed).toBe(false);
    expect(again.content).toBe(applied.content);
  });

  it("set-bullet：改要点文本，不动 point_ids", () => {
    const before = content();
    const applied = applyDocumentCommand(before, {
      kind: "set-bullet",
      path: "experience.0.description.1",
      text: "two!",
    });
    expect(applied.changed).toBe(true);
    expect(applied.content.experience[0].description).toEqual(["one", "two!"]);
    expect(applied.content.experience[0].point_ids?.description).toEqual([
      "ob_point0001",
      "ob_point0002",
    ]);
  });

  it("insert-bullet：文本与 point_ids 同步插入，并生成合法新 id", () => {
    const before = content();
    const applied = applyDocumentCommand(before, {
      kind: "insert-bullet",
      path: "experience.0.description",
      index: 1,
      text: "one-and-a-half",
    });
    const entry = applied.content.experience[0];
    expect(entry.description).toEqual(["one", "one-and-a-half", "two"]);
    const ids = entry.point_ids?.description ?? [];
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe("ob_point0001");
    expect(ids[2]).toBe("ob_point0002");
    expect(ids[1]).toMatch(/^ob_[a-z0-9]{12}$/);
    // 原内容不动。
    expect(before.experience[0].description).toEqual(["one", "two"]);
  });

  it("remove-bullet：文本与伴随 id 同步删除", () => {
    const before = content();
    const applied = applyDocumentCommand(before, {
      kind: "remove-bullet",
      path: "experience.0.description",
      index: 0,
    });
    expect(applied.content.experience[0].description).toEqual(["two"]);
    expect(applied.content.experience[0].point_ids?.description).toEqual(["ob_point0002"]);
  });

  it("越界 / 非数组路径是 no-op（不制造历史点）", () => {
    const before = content();
    expect(
      applyDocumentCommand(before, {
        kind: "remove-bullet",
        path: "experience.0.description",
        index: 9,
      }).changed,
    ).toBe(false);
    expect(
      applyDocumentCommand(before, {
        kind: "insert-bullet",
        path: "experience.9.description",
        index: 0,
        text: "n",
      }).changed,
    ).toBe(false);
  });
});

describe("commands · 结构命令委托 W06", () => {
  it("reorder-entry 保留 id、交换顺序（与 applyOutlineCommand 同一实现）", () => {
    const before = ensureIds(content());
    const applied = applyDocumentCommand(before, {
      kind: "structure",
      command: { type: "reorder-entry", field: "experience", objectId: "ob_entry0002", toIndex: 0 },
    });
    expect(applied.changed).toBe(true);
    expect(applied.content.experience.map((entry) => entry.id)).toEqual([
      "ob_entry0002",
      "ob_entry0001",
    ]);
    expect(applied.content.experience[0].company).toBe("B");
  });
});

describe("commands · 历史声明", () => {
  it("mergeKey：同一路径的连续文本输入合并，结构命令独立成步", () => {
    expect(mergeKeyOf({ kind: "set-text", path: "name", text: "x" })).toBe("text:name");
    expect(mergeKeyOf({ kind: "set-bullet", path: "experience.0.description.0", text: "x" })).toBe(
      "text:experience.0.description.0",
    );
    expect(
      mergeKeyOf({
        kind: "structure",
        command: {
          type: "reorder-entry",
          field: "experience",
          objectId: "ob_entry0001",
          toIndex: 1,
        },
      }),
    ).toBeNull();
  });

  it("bumpsRevision 对所有命令为 true（本层没有纯选择命令）", () => {
    expect(bumpsRevision({ kind: "set-text", path: "name", text: "x" })).toBe(true);
  });
});
