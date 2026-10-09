/**
 * `WebFormProfileGroup` 自定义 memo 比较器的语义。
 *
 * 它是「我的资料 → 网申资料」输入卡顿修复的核心：击键时整份 `values` 会换成新对象，
 * 只有把「values 变了」收窄成「**本组**的 values 变了」，未编辑的组才能整棵跳过重渲。
 * 这里直接对导出的纯函数下断言（不去做脆弱的渲染计数），把优化语义钉死。
 */
import { describe, expect, it } from "vitest";
import type { WebFormField } from "../../types";
import { areGroupPropsEqual, type WebFormProfileGroupProps } from "./WebFormProfileGroup";

const FIELDS: WebFormField[] = [
  { key: "cet6_score", label: "英语六级分数", group: "语言与证书", kind: "text", sensitive: false },
  { key: "student_id", label: "学号", group: "语言与证书", kind: "text", sensitive: false },
];

// 稳定引用：比较器对回调/entries 按引用比较，测试里用模块级常量才不会误判。
// （生产代码里 entries 由 `useMemo(..., [details])` 产出，击键期间引用恒定。）
const ENTRIES = {};
function noop(): void {}
function rename(): string | undefined {
  return undefined;
}
function displayLabel(field: WebFormField): string {
  return field.label;
}

function props(overrides: Partial<WebFormProfileGroupProps> = {}): WebFormProfileGroupProps {
  return {
    group: "语言与证书",
    fields: FIELDS,
    groupAllFields: FIELDS,
    filledCount: 0,
    editing: true,
    saving: false,
    values: {},
    entries: ENTRIES,
    displayLabel,
    onChange: noop,
    onRename: rename,
    onDelete: noop,
    ...overrides,
  };
}

describe("areGroupPropsEqual", () => {
  it("完全相同的 props → 相等（打字时未编辑组据此 bail）", () => {
    expect(areGroupPropsEqual(props(), props())).toBe(true);
  });

  it("只有**别的** key 的值变化 → 视为相等（本组 fields 覆盖不到它）", () => {
    const previous = props({ values: { cet6_score: "512" } });
    const next = props({ values: { cet6_score: "512", some_other_field: "x" } });
    expect(areGroupPropsEqual(previous, next)).toBe(true);
  });

  it("本组某个 key 的值变化 → 不相等（必须重渲）", () => {
    const previous = props({ values: { cet6_score: "512" } });
    const next = props({ values: { cet6_score: "520" } });
    expect(areGroupPropsEqual(previous, next)).toBe(false);
  });

  it("fields 变短（值被清空导致字段被过滤移出）→ 不相等", () => {
    const previous = props();
    const next = props({ fields: [FIELDS[0]] });
    expect(areGroupPropsEqual(previous, next)).toBe(false);
  });

  it("同一批 key 换顺序 → 不相等", () => {
    const previous = props();
    const next = props({ fields: [FIELDS[1], FIELDS[0]] });
    expect(areGroupPropsEqual(previous, next)).toBe(false);
  });

  it("计数 / 回调等非列表 props 变化 → 不相等", () => {
    const base = props();
    expect(areGroupPropsEqual(base, props({ filledCount: 1 }))).toBe(false);
    expect(areGroupPropsEqual(base, props({ onChange: () => {} }))).toBe(false);
    expect(areGroupPropsEqual(base, props({ editing: false }))).toBe(false);
  });
});
