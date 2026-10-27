// SPDX-License-Identifier: Apache-2.0
/**
 * 自建板块：**字段定义 → 条目值**的对齐（第 8 项，2026-10-27）。
 *
 * ## 为什么需要它
 *
 * 自建板块在正文里的形状是 `{ key, title, entries: [{ entry_id, text, lines }] }`：
 * 一个字段进 `text`，其余字段按定义顺序进 `lines`（`label` 是字段 label）。选谁进
 * `text` 由服务端 `paper_policy.custom_section_text_field()` 决定（`primary_field_id`
 * 优先，否则第一个 `multi_line` 字段）——服务端已经在 `EditorFieldOut.primary` 上标了
 * 出来，本模块按同一个标记绑定，**不另立一套判定**。
 *
 * ## 为什么要在挂载时对齐
 *
 * 投影只把**有值**的行写进 `lines`（`paper_content_builder._project_custom_section`：
 * `if not value or not label: continue`）。所以一份刚投影出来的自建板块，`lines` 里
 * 只有用户填过的那几格，其余字段没有位置可绑——不补齐就根本没有输入框可填。
 *
 * 对齐规则（`alignCustomEntry`）：
 * 1. 按定义顺序，每个非主文本字段占一行：能在已有 `lines` 里按 label 找回原值就沿用，
 *    找不到就补一个空行（label 用定义 label）；
 * 2. 已有的行里，label 在定义中匹配不到（历史数据 / 字段被删 / 用户手加的）**一条都不删**，
 *    按原顺序排在定义字段之后，继续可编辑可保存；
 * 3. 匹配上的行把 label 归一成定义 label（服务端投影本来就用定义 label 重建行，
 *    归一不影响纸面，但能让下次对齐稳定命中）；
 * 4. 函数是幂等的：对齐过的结果再对齐一次不再变化（`changed` 为 false）。
 */

import type { EditorFieldOut } from "../../features/profile-library/types";
import type { ResumeCustomLine } from "../../types";

/** 一个定义字段 → 它在对齐后 `lines` 数组里的下标。 */
export interface CustomLineBinding {
  field: EditorFieldOut;
  lineIndex: number;
}

export interface CustomEntryAlignment {
  /** 绑定到 `entry.text` 的字段；null = 该板块一个多行字段都没有（全部走 lines）。 */
  textField: EditorFieldOut | null;
  /** 定义字段 → lines 下标（定义顺序）。 */
  bindings: CustomLineBinding[];
  /** 定义之外的历史行下标（排在定义字段之后）。 */
  extraLineIndexes: number[];
  /** 对齐后的完整 lines（写回表单/保存用）。 */
  alignedLines: ResumeCustomLine[];
  /** 对齐结果与原值不同（调用方据此决定是否要写回表单）。 */
  changed: boolean;
}

/**
 * 主文本字段：服务端的 `primary` 优先；旧快照没有这个标记时退回「第一个多行字段」。
 *
 * 两者都与后端 `custom_section_text_field()` 的判定一致：`primary_field_id` →
 * 第一个 `multi_line` → 都没有则没有主文本字段（所有字段都进「标签：值」行）。
 */
export function pickCustomTextField(fields: readonly EditorFieldOut[]): EditorFieldOut | null {
  const primary = fields.find((field) => field.primary === true);
  if (primary) return primary;
  return fields.find((field) => field.field_type === "multi_line") ?? null;
}

function normalize(line: ResumeCustomLine | undefined): ResumeCustomLine {
  return { label: (line?.label ?? "").trim(), value: line?.value ?? "" };
}

function sameLine(a: ResumeCustomLine | undefined, b: ResumeCustomLine): boolean {
  return (a?.label ?? "") === b.label && (a?.value ?? "") === b.value;
}

/**
 * 把一个条目的 `lines` 对齐到板块的字段定义（见文件头四条规则）。
 *
 * `fields` 为空（旧快照 / 板块已被删）时原样返回，调用方走通用编辑器兜底。
 */
export function alignCustomEntry(
  fields: readonly EditorFieldOut[],
  lines: readonly ResumeCustomLine[] | undefined,
): CustomEntryAlignment {
  const source = (lines ?? []).map(normalize);
  if (fields.length === 0) {
    return {
      textField: null,
      bindings: [],
      extraLineIndexes: source.map((_, index) => index),
      alignedLines: source,
      changed: false,
    };
  }

  const textField = pickCustomTextField(fields);
  const lineFields = fields.filter((field) => field !== textField);
  const used = new Set<number>();
  const alignedLines: ResumeCustomLine[] = [];
  const bindings: CustomLineBinding[] = [];

  for (const field of lineFields) {
    const label = field.label.trim();
    const hit = source.findIndex(
      (line, index) => !used.has(index) && line.label === label && label !== "",
    );
    const lineIndex = alignedLines.length;
    if (hit >= 0) {
      used.add(hit);
      // 值沿用，label 归一成定义 label（服务端投影也用定义 label 重建行）。
      alignedLines.push({ label, value: source[hit].value });
    } else {
      alignedLines.push({ label, value: "" });
    }
    bindings.push({ field, lineIndex });
  }

  const extraLineIndexes: number[] = [];
  source.forEach((line, index) => {
    if (used.has(index)) return;
    // 空行（label 与 value 都是空）不算"历史行"：`Form.Item` 一旦绑到还不存在的下标，
    // rc-field-form 就会把那个下标登记成一个空对象，watched 值里凭空多出一行 `{}`。
    // 把它当历史行留着，下次对齐会再补一行，越对齐越长（实测 2 行变 3 行）。空行本身
    // 没有任何内容可丢，投影也会跳过它（`if not value or not label: continue`）。
    if (line.label === "" && line.value === "") return;
    extraLineIndexes.push(alignedLines.length);
    alignedLines.push(line);
  });

  const changed =
    alignedLines.length !== source.length ||
    alignedLines.some((line, index) => !sameLine(source[index], line));

  return { textField, bindings, extraLineIndexes, alignedLines, changed };
}

/**
 * 一个自建板块条目在「有字段定义」时的初始 lines（新建条目用）。
 *
 * 与对齐同一个内核：没有历史值可沿用时，每个非主文本字段各占一个空行。
 */
export function emptyCustomEntryLines(fields: readonly EditorFieldOut[]): ResumeCustomLine[] {
  return alignCustomEntry(fields, []).alignedLines;
}
