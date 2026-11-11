// SPDX-License-Identifier: Apache-2.0
/**
 * 「查重复条目」的判据（#27A 复用 #20）。
 *
 * #20 修的是"同一份资料被识别成多份"：**同一分区**内，锚点（学校/公司/项目名）
 * 相等或是前缀（短的一侧字面长度 ≥4），且**日期不冲突、角色不冲突**时合并成一条。
 * 投机这次要在划词动作里用同一套判据，所以判据在这里以**纯函数**形式重写一份
 * 前端镜像；口径逐条对齐 `backend/app/services/profile_entry_dedup.py`：
 *
 * - `normalizeAnchor`：NFKC + 去所有空白 + casefold（`toLocaleLowerCase`），
 *   剥首尾 `* # _ ~`——剥完字面长度 <4 时保留原串（保护 `C#` / `.NET` 这类短名）；
 * - `sameAnchor`：全等，或短的一侧是长的一侧的前缀且短的一侧字面长度 ≥4；
 * - 日期保护：两侧 start/end 都非空且不相等 → 不合并（同公司两段任职是合法的）；
 * - 角色保护：两侧 role 都非空且不相等 → 不合并（工程师 / 高级工程师是两段任职）。
 *
 * 注：#20 的后端实现还包含 AI↔本地配对与技能白名单，这里只镜像"用户选中一段经历后
 * 查资料里有没有重复条目"用得到的那几段判据，不重写整个后端模块。
 */
import type { Profile } from "../../types";

export interface DuplicateEntryAnchor {
  /** 展示用（分区 + 序号），不参与判定。 */
  id: string;
  /** 分区 id：educations / experiences / campus_experiences / projects … */
  section: string;
  /** 锚点原文（学校名 / 公司名 / 项目名）。 */
  anchor: string;
  role?: string;
  startDate?: string;
  endDate?: string;
}

export interface DuplicateEntryPair {
  left: DuplicateEntryAnchor;
  right: DuplicateEntryAnchor;
  section: string;
}

const DECORATION = /^[*#_~\s]+|[*#_~\s]+$/gu;
const WHITESPACE = /\s+/gu;
/** 前缀匹配的最短字面长度（#20 的 FIX-1 同值）。 */
export const DUPLICATE_ANCHOR_MIN_LENGTH = 4;

function lengthOf(value: string): number {
  return Array.from(value).length;
}

export function normalizeAnchor(value: string): string {
  const stripped = value.normalize("NFKC").replace(WHITESPACE, "").toLocaleLowerCase();
  const undecorated = stripped.replace(DECORATION, "");
  return lengthOf(undecorated) >= DUPLICATE_ANCHOR_MIN_LENGTH ? undecorated : stripped;
}

function normalizeRole(value: string | undefined): string {
  return (value ?? "").normalize("NFKC").replace(WHITESPACE, "").toLocaleLowerCase();
}

/** 锚点相同：全等，或短的一侧是长的一侧的前缀（短侧字面长度 ≥4）。 */
export function sameAnchor(left: string, right: string): boolean {
  const a = normalizeAnchor(left);
  const b = normalizeAnchor(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = lengthOf(a) <= lengthOf(b) ? [a, b] : [b, a];
  if (lengthOf(shorter) < DUPLICATE_ANCHOR_MIN_LENGTH) return false;
  return longer.startsWith(shorter);
}

/** 日期保护：两侧都填了、且不相等 → 视为两段不同经历，不合并。 */
export function hasDateConflict(left: DuplicateEntryAnchor, right: DuplicateEntryAnchor): boolean {
  const pairs: [string | undefined, string | undefined][] = [
    [left.startDate, right.startDate],
    [left.endDate, right.endDate],
  ];
  return pairs.some(([a, b]) => {
    const first = (a ?? "").trim();
    const second = (b ?? "").trim();
    return first !== "" && second !== "" && first !== second;
  });
}

/** 角色保护：两侧角色都填了、且不相等 → 视为两段任职，不合并。 */
export function hasRoleConflict(left: DuplicateEntryAnchor, right: DuplicateEntryAnchor): boolean {
  const first = normalizeRole(left.role);
  const second = normalizeRole(right.role);
  return first !== "" && second !== "" && first !== second;
}

function mentionsAnchor(selection: string, anchor: string): boolean {
  const normalizedSelection = normalizeAnchor(selection);
  const normalizedAnchor = normalizeAnchor(anchor);
  if (!normalizedAnchor) return false;
  if (lengthOf(normalizedAnchor) < DUPLICATE_ANCHOR_MIN_LENGTH) return false;
  return normalizedSelection.includes(normalizedAnchor);
}

/**
 * 选中文本 vs 资料条目：找出"同一条经历在资料里出现两次"的配对。
 *
 * 先把选中文本里出现过的锚点找出来（选中一整段经历时公司/学校名就在文本里），
 * 再在同一分区内按 #20 判据两两比对。选中文本里一个锚点都没出现时返回空——
 * 不猜、不拿整份资料乱配。
 */
export function findDuplicatePairs(
  entries: readonly DuplicateEntryAnchor[],
  selectedText: string,
): DuplicateEntryPair[] {
  const mentioned = entries.filter((entry) => mentionsAnchor(selectedText, entry.anchor));
  const bySection = new Map<string, DuplicateEntryAnchor[]>();
  for (const entry of mentioned) {
    const bucket = bySection.get(entry.section) ?? [];
    bucket.push(entry);
    bySection.set(entry.section, bucket);
  }
  const pairs: DuplicateEntryPair[] = [];
  for (const [section, bucket] of bySection) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const left = bucket[i];
        const right = bucket[j];
        if (!sameAnchor(left.anchor, right.anchor)) continue;
        if (hasDateConflict(left, right) || hasRoleConflict(left, right)) continue;
        pairs.push({ left, right, section });
      }
    }
  }
  return pairs;
}

/** Profile → 判据输入。只取有锚点意义的四个分区；技能/奖项不参与（#20 的边界）。 */
export function duplicateAnchorsFromProfile(profile: Profile): DuplicateEntryAnchor[] {
  const entries: DuplicateEntryAnchor[] = [];
  profile.educations.forEach((item, index) => {
    entries.push({
      id: `educations:${item.id ?? index}`,
      section: "educations",
      anchor: item.school,
      role: item.major,
      startDate: item.start_date,
      endDate: item.end_date,
    });
  });
  profile.experiences.forEach((item, index) => {
    entries.push({
      id: `experiences:${item.id ?? index}`,
      section: "experiences",
      anchor: item.company,
      role: item.role,
      startDate: item.start_date,
      endDate: item.end_date,
    });
  });
  profile.campus_experiences.forEach((item, index) => {
    entries.push({
      id: `campus_experiences:${item.id ?? index}`,
      section: "campus_experiences",
      anchor: item.organization,
      role: item.role,
      startDate: item.start_date,
      endDate: item.end_date,
    });
  });
  profile.projects.forEach((item, index) => {
    entries.push({
      id: `projects:${item.id ?? index}`,
      section: "projects",
      anchor: item.name,
      role: item.role,
      startDate: item.start_date,
      endDate: item.end_date,
    });
  });
  return entries;
}
