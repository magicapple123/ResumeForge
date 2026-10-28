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
