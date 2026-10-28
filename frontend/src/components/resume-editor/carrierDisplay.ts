// SPDX-License-Identifier: Apache-2.0
/**
 * 承载区正文框的**显示过滤**（任务 #8）：项目描述这类文本域只显示用户手写的行，
 * 不把该板块自定义字段的「标签：值」行混进去（用户反馈：描述框里出现「啦啦啦：123456」）。
 *
 * ## 为什么在显示层做，而不是把值搬出承载区
 *
 * 自定义字段的值按纸面口径**就存在承载区那一行**（见 `carrierFieldValue.ts`），纸面、导出、
 * AI 生成后处理都直接读它；保存链（`mergeEditorContent`）、草稿、撤回历史、冲突另存也
 * 都以"承载区整段文本"为口径。把行搬出 Form 值等于把这些链路全部改一遍，风险远大于收益。
 *
 * 这里只做两件事，数据形状与保存链零改动：
 *
 * 1. `getValueProps`：把承载区里属于**已知自定义字段标签**的行滤掉再交给文本域；
 * 2. `normalize`：用户改完文本域后，把刚滤掉的行**原样并回**（保持原顺序）；用户手打进
 *    文本域的「标签：值」行也归并回标签行——保证同一标签在承载区里永远只有一行。
 *
 * `normalize` 的第二个参数是同一路径的**上一个值**（整段承载区），所以隐藏行不会丢：
 * 编辑文本域 = 用户行替换 + 保留隐藏行，保存后纸面/导出照旧显示它们。
 */
import { useMemo } from "react";
import type { FormItemProps } from "antd";
import type { EditorSectionOut } from "../../features/profile-library/types";
import { carrierLineValue } from "./carrierFieldValue";
import { useEditorSchemaSections } from "./editorSchemaContext";
import { multilineItemProps, splitLines } from "./resumeFieldUtils";

/** 该板块里"承载区中属于自定义字段"的标签。 */
export interface CarrierDisplay {
  labels: string[];
  /** 承载区是字符串数组（description）还是标量（note / level）。 */
  isList: boolean;
}

/**
 * Form.Item 的 `getValueProps` / `normalize` 两个口子（没有过滤需求时为空对象）。
 *
 * 直接复用 antd 的字段类型：这里只是"把两种实现的 props 原样转交给 Form.Item"，
 * 自己再声明一份签名会与 `multilineItemProps` 的 `string[]` 参数互相打架。
 */
export type CarrierFormProps = Pick<FormItemProps, "getValueProps" | "normalize">;

function toLines(carrier: unknown): string[] {
  if (Array.isArray(carrier)) return carrier.map((item) => String(item ?? ""));
  if (typeof carrier === "string") return carrier.split(/\r?\n/);
  return [];
}

function matchLabel(line: string, labels: readonly string[]): string | null {
  for (const label of labels) {
    if (carrierLineValue(line, label) !== null) return label;
  }
  return null;
}

/**
 * 这个正文数组字段（education / projects / publications / …）在承载区里有哪些自定义字段标签。
 *
 * 没有方案视图、板块没有承载区、或没有自定义字段时返回 null——调用方退回改动前的
 * 原样行为（旧简历/旧快照零影响）。
 */
export function carrierDisplayFor(
  sections: readonly EditorSectionOut[],
  resumeField: string,
): CarrierDisplay | null {
  const section = sections.find((item) => item.resume_field === resumeField && item.carrier_attr);
  if (!section?.carrier_attr) return null;
  const labels = section.fields
    .filter((field) => field.resume_attr === null)
    .map((field) => field.label.trim())
    .filter(Boolean);
  if (labels.length === 0) return null;
  return { labels, isList: Boolean(section.carrier_list) };
}

/** 把整段承载区拆成「用户可见行」与「自定义字段行」。 */
export function splitCarrierLines(
  carrier: unknown,
  labels: readonly string[],
): { visible: string[]; extras: string[] } {
  const visible: string[] = [];
  const extras: string[] = [];
  for (const line of toLines(carrier)) {
    (matchLabel(line, labels) === null ? visible : extras).push(line);
  }
  return { visible, extras };
}

/** 同一标签只留一行：去掉旧行，把新行放到隐藏行末尾。 */
function replaceLabelLine(extras: string[], label: string, line: string): string[] {
  return [...extras.filter((item) => carrierLineValue(item, label) === null), line];
}

/** 历史/手写数据里同一标签可能出现多行：按「第一次出现」保留一行，其余丢弃。 */
function dedupeExtras(extras: string[], labels: readonly string[]): string[] {
  const seen = new Set<string>();
  return extras.filter((line) => {
    const label = matchLabel(line, labels);
    if (label === null) return true;
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });
}

/**
 * 用户编辑正文后的整段承载区：用户行在前，隐藏的自定义字段行原顺序在后。
 * 用户手打进正文的「标签：值」行会被归并进隐藏行（不会在承载区里出现两行同标签）。
 */
export function mergeCarrierText(
  previous: unknown,
  text: string,
  labels: readonly string[],
  isList: boolean,
): string | string[] {
  const extras = dedupeExtras(splitCarrierLines(previous, labels).extras, labels);
  const visible: string[] = [];
  let hidden = extras;
  for (const line of splitLines(text)) {
    const label = matchLabel(line, labels);
    if (label === null) {
      visible.push(line);
      continue;
    }
    hidden = replaceLabelLine(hidden, label, line);
  }
  const merged = [...visible, ...hidden];
  return isList ? merged : merged.join("\n");
}

/**
 * 承载区正文框的 Form.Item props。
 *
 * `fallbackIsList`：没有方案视图时按调用方知道的分区形状退回`multilineItemProps`（列表）
 * 或空对象（标量）——行为与改动前逐字一致。
 */
export function useCarrierDisplayProps(
  resumeField: string,
  fallbackIsList: boolean,
): CarrierFormProps {
  const sections = useEditorSchemaSections();
  const display = useMemo(() => carrierDisplayFor(sections, resumeField), [sections, resumeField]);
  return useMemo<CarrierFormProps>(() => {
    if (!display) return fallbackIsList ? multilineItemProps : {};
    const { labels, isList } = display;
    return {
      getValueProps: (value: unknown) => ({
        value: splitCarrierLines(value, labels).visible.join("\n"),
      }),
      normalize: (value: unknown, previous: unknown) =>
        mergeCarrierText(previous, String(value ?? ""), labels, isList),
    };
  }, [display, fallbackIsList]);
}
