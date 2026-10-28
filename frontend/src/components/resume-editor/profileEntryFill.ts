// SPDX-License-Identifier: Apache-2.0
/**
 * 条目级的「从资料填入本条」（任务 #9）：所有**多条目板块**共用的候选 + 填空逻辑。
 *
 * 为什么单独成文件：弹窗的六个列表（教育/经历/校园/项目/技能/荣誉）走
 * `ResumeListSection`，科研三栏/证照/语言走各自容器——"哪些候选、怎么只填空字段、
 * 哪些选项该禁用"必须只有一份实现，否则资料页加了字段就要改两处（本仓库反复踩过）。
 *
 * 语义（与旧条目级入口逐字一致）：
 * - **只做加法**：只写空字段（空串/空数组/undefined 都算空），用户手写的内容一个字不覆盖；
 * - **不重复**：候选条目"已在其它条目里用过"或"就是本条自己"时不可再选；
 * - 写完调用 `fill.onFilled()`，脏值与保存链路与手打完全一样。
 */
import { Form } from "antd";
import type { ResumeCustomEntry } from "../../types";
import {
  PROFILE_FILL_KEYS,
  type ProfileFillItem,
  type ProfileFillSection,
} from "../../features/profile/profileFillOptions";
import { useProfileFill } from "./profileFillContext";

/** 表单里的"空"有三种写法：字段不存在、空串、空数组。三者都算空。 */
export function isBlankValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * 把候选条目写进当前条目：**只填空字段**。
 *
 * 数组要复制一份：候选对象属于投影缓存，两次填入不能共用同一个数组引用。
 */
export function fillBlankFields(
  entry: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...entry };
  for (const [key, value] of Object.entries(source)) {
    if (!isBlankValue(next[key]) || isBlankValue(value)) continue;
    next[key] = Array.isArray(value) ? [...value] : value;
  }
  return next;
}

/** 「标签」的比对口径：首尾空白不算区别（用户手打空格不该多出一行）。 */
function normalizedLineLabel(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 自建板块条目填入结果：`changed=false` 时调用方不写表单，避免凭空多一条脏值。 */
export interface CustomEntryFillResult {
  entry: ResumeCustomEntry;
  changed: boolean;
}

/**
 * 自建板块条目级的「从资料填入本条」：**只补空值**，且不复制身份。
 *
 * 与系统板块的 `fillBlankFields` 分开，因为数据形状不同：
 * - `text` 是单个大字段：空才填；
 * - `lines` 是「标签：值」行：按 label 合并——已有同 label 的非空值不覆盖、空值补上、
 *   缺失 label 按资料顺序追加到末尾，已有行顺序不变（那是用户看得见的结构）；
 * - **不复制 `entry_id`**：它是资料条目的稳定身份，写进当前条目会与正文身份冲突。
 */
export function fillCustomEntryFromSource(
  entry: Partial<ResumeCustomEntry> | null | undefined,
  source: Partial<Pick<ResumeCustomEntry, "text" | "lines">> | null | undefined,
): CustomEntryFillResult {
  const base: ResumeCustomEntry = {
    entry_id: typeof entry?.entry_id === "string" ? entry.entry_id : "",
    text: typeof entry?.text === "string" ? entry.text : "",
    lines: Array.isArray(entry?.lines) ? entry.lines : [],
  };
  let changed = false;
  let nextText = base.text;
  if (isBlankValue(base.text) && !isBlankValue(source?.text)) {
    nextText = String(source?.text);
    changed = true;
  }
  const lines = base.lines.map((line) => ({ ...line }));
  const sourceLines = Array.isArray(source?.lines) ? source.lines : [];
  for (const sourceLine of sourceLines) {
    const label = normalizedLineLabel(sourceLine?.label);
    const value = typeof sourceLine?.value === "string" ? sourceLine.value : "";
    if (!label || isBlankValue(value)) continue;
    const existing = lines.find((line) => normalizedLineLabel(line.label) === label);
    if (!existing) {
      lines.push({
        label: typeof sourceLine.label === "string" ? sourceLine.label : label,
        value,
      });
      changed = true;
    } else if (isBlankValue(existing.value)) {
      existing.value = value;
      changed = true;
    }
  }
  return { entry: { ...base, text: nextText, lines }, changed };
}

export interface ProfileEntryFill {
  /** 宿主有没有候选来源（没提供 Provider / 没给该分区候选 → 入口完全不渲染）。 */
  available: boolean;
  items: ProfileFillItem[];
  /** 每条自己的去重键（下标 = Form.List 里的下标）。 */
  entryKeys: (string | undefined)[];
  /** 全部条目已用过的键（用来标"已在其他条目"）。 */
  existingKeys: Set<string>;
  /** 把候选填进第 index 条的空字段。 */
  fillEntry: (index: number, item: ProfileFillItem) => void;
}

/**
 * 一个多条目板块的条目级填入状态。
 *
 * `contentField` 是 ResumeContent 里的数组字段名（= Form.List 的 name，与候选的
 * `paper_content_path` 首段一致）；`fillSection` 是候选桶名（没有候选来源时传 undefined）。
 */
export function useProfileEntryFill(
  contentField: string,
  fillSection: ProfileFillSection | undefined,
): ProfileEntryFill {
  const fill = useProfileFill();
  const form = Form.useFormInstance();
  const current = Form.useWatch(contentField, form) as unknown[] | undefined;
  const keyOf = fillSection ? PROFILE_FILL_KEYS[fillSection] : null;
  const entryKeys: (string | undefined)[] = keyOf ? (current ?? []).map((item) => keyOf(item)) : [];
  const items = (fillSection ? fill?.sources[fillSection] : undefined) ?? [];

  const fillEntry = (index: number, item: ProfileFillItem): void => {
    const list = (form.getFieldValue(contentField) as unknown[] | undefined) ?? [];
    if (index < 0 || index >= list.length) return;
    const next = fillBlankFields(
      (list[index] ?? {}) as Record<string, unknown>,
      (item.value ?? {}) as Record<string, unknown>,
    );
    // 整表写回（而不是 `[name, index]`）：Form.List 的数组本身必须是**新引用**，
    // 否则 useWatch 与列表渲染都不会认为它变了。
    form.setFieldValue(
      contentField,
      list.map((entry, position) => (position === index ? next : entry)),
    );
    fill?.onFilled();
  };

  return {
    available: Boolean(fill && fillSection && items.length > 0),
    items,
    entryKeys,
    existingKeys: new Set(entryKeys.filter((key): key is string => Boolean(key))),
    fillEntry,
  };
}
