// SPDX-License-Identifier: Apache-2.0
/**
 * 自建板块的字段对齐内核（第 8 项）：纯函数单测。
 *
 * 这里钉的是"值不会因为对齐而丢"与"对齐可重入"两件事——它们坏掉时用户看到的是
 * 「保存后某些字段没了」或「每次打开都多一行空行」，都属于最难回溯的那类问题。
 *
 * 字段 label 用 ASCII（夹具，不是产品文案）。
 */
import { describe, expect, it } from "vitest";
import type { EditorFieldOut } from "../../features/profile-library/types";
import {
  alignCustomEntry,
  emptyCustomEntryLines,
  pickCustomTextField,
} from "./customSectionAlignment";

function field(
  label: string,
  type: EditorFieldOut["field_type"],
  primary?: boolean,
): EditorFieldOut {
  return {
    field_id: `f.${label}`,
    key: label.toLowerCase(),
    label,
    field_type: type,
    resume_attr: null,
    ...(primary === undefined ? {} : { primary }),
  };
}

const GIST = field("Gist", "multi_line", true);
const ROLE = field("Role", "single_line");
const LINK = field("Link", "single_line");
const FIELDS = [GIST, ROLE, LINK];

describe("pickCustomTextField", () => {
  it("服务端 primary 优先", () => {
    expect(pickCustomTextField(FIELDS)?.label).toBe("Gist");
    const overridden = [field("Note", "multi_line"), field("Body", "multi_line", true)];
    expect(pickCustomTextField(overridden)?.label).toBe("Body");
  });

  it("旧快照没有 primary 时退回第一个多行字段", () => {
    const legacy = [ROLE, field("Body", "multi_line"), field("Note", "multi_line")];
    expect(pickCustomTextField(legacy)?.label).toBe("Body");
  });

  it("一个多行字段都没有时没有主文本字段", () => {
    expect(pickCustomTextField([ROLE, LINK])).toBeNull();
  });
});

describe("alignCustomEntry", () => {
  it("按定义顺序补齐缺失字段，已存在的值原样沿用", () => {
    const result = alignCustomEntry(FIELDS, [{ label: "Link", value: "https://x.dev" }]);
    expect(result.textField?.label).toBe("Gist");
    expect(result.bindings.map((item) => item.field.label)).toEqual(["Role", "Link"]);
    expect(result.alignedLines).toEqual([
      { label: "Role", value: "" },
      { label: "Link", value: "https://x.dev" },
    ]);
    expect(result.extraLineIndexes).toEqual([]);
    expect(result.changed).toBe(true);
  });

  it("定义之外的历史行排在后面，一条都不丢", () => {
    const result = alignCustomEntry(FIELDS, [
      { label: "Role", value: "maintainer" },
      { label: "Legacy", value: "keep" },
    ]);
    expect(result.alignedLines).toEqual([
      { label: "Role", value: "maintainer" },
      { label: "Link", value: "" },
      { label: "Legacy", value: "keep" },
    ]);
    expect(result.extraLineIndexes).toEqual([2]);
  });

  it("命中定义的行把 label 归一（两端空白 / 旧写法）", () => {
    const result = alignCustomEntry(FIELDS, [{ label: "  Role ", value: "x" }]);
    expect(result.alignedLines[0]).toEqual({ label: "Role", value: "x" });
  });

  it("空行不算历史行（Form.Item 登记出来的 {} 不该被当成数据）", () => {
    const result = alignCustomEntry(FIELDS, [
      { label: "Role", value: "x" },
      { label: "", value: "" },
    ]);
    expect(result.alignedLines).toEqual([
      { label: "Role", value: "x" },
      { label: "Link", value: "" },
    ]);
    expect(result.extraLineIndexes).toEqual([]);
  });

  it("幂等：对齐结果再对齐一次不再变化", () => {
    const first = alignCustomEntry(FIELDS, [{ label: "Legacy", value: "keep" }]);
    const second = alignCustomEntry(FIELDS, first.alignedLines);
    expect(second.alignedLines).toEqual(first.alignedLines);
    expect(second.changed).toBe(false);
  });

  it("没有字段定义时原样返回（调用方走通用编辑器兜底）", () => {
    const lines = [{ label: "A", value: "1" }];
    const result = alignCustomEntry([], lines);
    expect(result.alignedLines).toEqual(lines);
    expect(result.extraLineIndexes).toEqual([0]);
    expect(result.changed).toBe(false);
  });

  it("新建条目的初始行：每个非主文本字段一行空值", () => {
    expect(emptyCustomEntryLines(FIELDS)).toEqual([
      { label: "Role", value: "" },
      { label: "Link", value: "" },
    ]);
  });
});
