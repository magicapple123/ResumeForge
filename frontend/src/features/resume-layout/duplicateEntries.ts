// SPDX-License-Identifier: Apache-2.0
/**
 * D03 的「重复条目提醒」：用户多选批量改间距时，最容易顺手把两条内容也改得一样。
 *
 * 判据是**内容文本**（标题 + 元信息，如公司/时间）归一化后相同，而不是 id 或下标：
 * 复制条目会生成新 id（W00 §3.2），下标排序后会漂——拿它们当判据会漏报。
 *
 * 纯函数、无 UI：批量条、对象面板、大纲都可以引用同一份判据（一处逻辑一份实现）。
 */

export interface EntryIdentity {
  /** 稳定对象 id（`document_identity` 形状）。 */
  id: string;
  /** 条目标题（公司名 / 项目名 / 学校名…）。 */
  label: string;
  /** 元信息（时间范围 / 岗位 / 专业…），可缺省。 */
  meta?: string;
}

export interface DuplicateGroup {
  /** 归一化后的内容键（仅用于分组与稳定排序，不显示）。 */
  key: string;
  /** 这一组的标题（取第一条原文，显示用）。 */
  label: string;
  /** 组内所有对象 id（保持输入顺序）。 */
  ids: string[];
  count: number;
}

/** 归一化：去首尾空白、压缩连续空白、转小写。 */
function normalize(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * 找出内容重复的条目组（同一 `label` + `meta` 出现 ≥2 次）。
 *
 * - 空标题不参与（"未命名条目"是数据缺失，不是重复内容）；
 * - 返回组按"重复条数降序、内容键升序"排序，界面上最重要的先说；
 * - 组内 id 顺序 = 输入顺序（多选条的展示顺序稳定）。
 */
export function findDuplicateTargets(entries: readonly EntryIdentity[]): DuplicateGroup[] {
  const groups = new Map<string, { label: string; ids: string[] }>();
  for (const entry of entries) {
    const label = normalize(entry.label);
    if (!label) continue;
    const key = `${label}\u0000${normalize(entry.meta)}`;
    const group = groups.get(key);
    if (group) group.ids.push(entry.id);
    else groups.set(key, { label: entry.label.trim(), ids: [entry.id] });
  }
  const duplicates: DuplicateGroup[] = [];
  for (const [key, group] of groups) {
    if (group.ids.length < 2) continue;
    duplicates.push({ key, label: group.label, ids: group.ids, count: group.ids.length });
  }
  duplicates.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return duplicates;
}
