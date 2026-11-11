// SPDX-License-Identifier: Apache-2.0
/**
 * 未收录资料提示的**纯数据整理**（从 `ResumeCoverageNotes` 搬来，问题 8；5-A 重写）。
 *
 * 为什么单独成文件：详情顶部的诊断条要用「共 N 条」这个数字做徽标与无障碍名，
 * 而聚合规则必须只有一份——放在组件文件里导出函数会被 react-refresh 的
 * 「只导出组件」规则挡下，所以把纯函数放在这个模块里，组件与诊断条各自 import。
 *
 * **5-A 改了聚合键**：`(section, section_label)`，不再是只按 `section`。后端同一份
 * 清单里既有条目级 note（`项目经历`）也有字段级 note（`项目「X」的亮点`），只按
 * `section` 聚合会把两者并成一组，用户读到的"9 条项目"其实是 3 个项目名 + 6 条亮点句。
 *
 * 另外把三条原因轴（`filtered` / `capacity_omitted` / `model_omitted`）**摊成答案**：
 * 后端 5-A 起下发显式 `reasons`；旧记录没有这个字段时按 `capacity > filtered > model`
 * 推导，三类都不命中就是"未说明"——宁可不解释，也不把"名额"说成"不相关"。
 */
import type { MessageKey } from "../../i18n";
import type { CoverageReason, ResumeCoverageNote } from "../../types/resumeCoverage";

/**
 * `coverage_notes[].section` 是**资料分区键**（后端 `resume_coverage._SECTION_MAP`）：
 * 其中三个分区在资料侧是复数（`experiences` / `educations` / `campus_experiences`），
 * 与简历分区键不同名。显示前先归一到简历分区键，再查语言包（其余分区同名，不需要别名）。
 * 不归一的话，这三个分区在英文界面仍会回退后端中文。
 *
 * 归一**只用于查语言包**：发给后端的数据仍用原样的 `section`（见 `rawSection`）。
 */
const PROFILE_SECTION_KEY_ALIASES: Record<string, string> = {
  experiences: "experience",
  educations: "education",
  campus_experiences: "campus_experience",
};

/** 三条原因轴的**取值优先级**（与后端 `resume_coverage_notes.REASON_PRIORITY` 逐条一致）。 */
export const COVERAGE_REASON_PRIORITY: readonly CoverageReason[] = [
  "capacity",
  "filtered",
  "model",
];

/**
 * 组头汇总里原因的**显示顺序**：先"不相关"，再"名额"，最后"模型"。
 *
 * 与取值优先级刻意不同：优先级回答"一个名字落进多个桶时算哪一条"（名额优先，因为
 * 名额是硬约束），显示顺序回答"用户先读哪一句"（相关性是最常被问的那个原因）。
 */
export const COVERAGE_REASON_DISPLAY_ORDER: readonly CoverageReason[] = [
  "filtered",
  "capacity",
  "model",
];

/** 每组默认展开的条数：超出部分折叠，靠"展开全部"看。 */
export const DEFAULT_VISIBLE_ITEMS = 5;

/**
 * 单行省略的字符阈值：超过它的条目单行省略 + Tooltip 全文。
 *
 * 2026-11-10（问题 05-1）：48 → **30**。原先 40–48 字符档看着"有省略号、点开没有全文"——
 * 阈值比弹层实际能放的字符数大，`CoverageItemRow` 判定"不算长条"于是不挂 Tooltip，
 * 而 CSS 的单行省略照样生效（当时靠弹层横向滚动才能看到全文）。30 字符（≈375px @12.5px）
 * 是 560px 弹层内容盒里能整行放下的安全上限，超过就一定有 Tooltip 兜底。
 */
export const LONG_ITEM_CHARS = 30;

/** 回退推导时用的桶：原因 → note 上的数组字段（顺序由 {@link COVERAGE_REASON_PRIORITY} 给）。 */
const REASON_FIELD: Record<CoverageReason, keyof ResumeCoverageNote> = {
  capacity: "capacity_omitted",
  filtered: "filtered",
  model: "model_omitted",
};

/** 一个名字的最终原因：`null` 表示三轴都不命中（显示「未说明」）。 */
export type CoverageItemReason = CoverageReason | null;

/**
 * 原因 → 语言包 key。`null`（未说明）也走同一张表，不在组件里再写一遍分支。
 *
 * 这是**展示**映射：协议值本身（`filtered` / `capacity` / `model`）不翻译，只在界面上
 * 换成用户看得懂的名字（与岗位无关 / 超出名额 / 模型未采用 / 未说明）。
 */
export function coverageReasonLabelKey(reason: CoverageItemReason): MessageKey {
  if (reason === null) return "resume.coverage.reason.unknown";
  return `resume.coverage.reason.${reason}` as MessageKey;
}

/** 组内的一行（一条资料名 + 它的原因）。 */
export interface CoverageItem {
  name: string;
  /** `null` = 后端没说明、三个数组也解释不了，不许猜。 */
  reason: CoverageItemReason;
}

/** 聚合后的一组：`(section, section_label)` 唯一。 */
export interface CoverageGroup {
  /** React key：`section` + `section_label` 拼成的稳定串（组内唯一）。 */
  key: string;
  /** 归一后的分区键（**只用于查语言包**）。 */
  section: string;
  /** 后端原样的资料分区键（发给 `append-profile-entries` 的 `section_key`）。 */
  rawSection: string;
  /** 后端下发的原文标签，只在语言包缺该分区时回退。 */
  sectionLabel: string;
  /** 一条一行：名字已去重保序，原因随名字走。 */
  items: CoverageItem[];
  /** `items[].name` 的平铺（拼修订指令用）。 */
  names: string[];
  /** 后端 `total` 之和（可能大于 `items.length`：后端会截断名字列表）。 */
  total: number;
  /** 三条原因各几条（组头徽标用）。 */
  reasonCounts: Record<CoverageReason, number>;
  /** 有没有条目说不出原因（旧记录 / 三轴都不命中）。 */
  unknownCount: number;
  /** 组内出现两种以上原因（含"未说明"）时为真：只有这时才逐条补小徽标。 */
  mixedReason: boolean;
  /** 该组所有 note 的 `entry_ids` 并集（3-A 确定性补入用；空数组 = 无可补入条目）。 */
  entryIds: string[];
}

/** 三种按钮分支（3-A 决策表）。 */
export type CoverageAction = "append" | "revise" | "workbench";

/**
 * 「靠改写就能补」的分区：这些分区在简历文档里**已经有可写字段**，AI 修订只要改写
 * 已有 path 的 value 就行，不需要新增条目。其余分区一律只能去制作台添加。
 */
const AI_REWRITABLE_SECTIONS: ReadonlySet<string> = new Set(["skills", "languages", "summary"]);

/** 自建板块的分区键前缀（后端 `custom:<section_id>`，与文档分区 key 逐字相同）。 */
export function isCustomSection(section: string): boolean {
  return section.startsWith("custom:");
}

/** 一个名字的原因：显式 `reasons` 优先，缺失时按 `capacity > filtered > model` 推导。 */
export function reasonOf(note: ResumeCoverageNote, name: string): CoverageItemReason {
  const explicit = note.reasons?.[name];
  if (explicit === "capacity" || explicit === "filtered" || explicit === "model") return explicit;
  // 显式值不是三个协议值之一（后端将来扩展）：当作没写，继续走回退推导。
  for (const reason of COVERAGE_REASON_PRIORITY) {
    const bucket = note[REASON_FIELD[reason]];
    if (Array.isArray(bucket) && bucket.some((item) => String(item) === name)) return reason;
  }
  return null;
}

/**
 * 按 `(section, section_label)` 聚合，组顺序 = 该组合在 backend 数组里**首次出现**的位置。
 *
 * 名字在同一组内去重保序（同一名字被两条 note 报过时，保留先出现的那条原因）；
 * `entryIds` 取并集，`total` 求和——`coverageSummaryCount` 的求和口径因此不变。
 */
export function groupCoverageNotes(notes: ResumeCoverageNote[]): CoverageGroup[] {
  const groups = new Map<string, CoverageGroup>();
  for (const note of notes) {
    const section = PROFILE_SECTION_KEY_ALIASES[note.section] ?? note.section;
    const key = `${section}\u0000${note.section_label}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        section,
        rawSection: note.section,
        sectionLabel: note.section_label,
        items: [],
        names: [],
        total: 0,
        reasonCounts: { capacity: 0, filtered: 0, model: 0 },
        unknownCount: 0,
        mixedReason: false,
        entryIds: [],
      };
      groups.set(key, group);
    }
    group.total += note.total;
    for (const entryId of note.entry_ids ?? []) {
      const value = String(entryId ?? "");
      if (value && !group.entryIds.includes(value)) group.entryIds.push(value);
    }
    for (const rawName of note.names) {
      const name = String(rawName ?? "");
      if (!name || group.names.includes(name)) continue;
      const reason = reasonOf(note, name);
      group.items.push({ name, reason });
      group.names.push(name);
      if (reason) group.reasonCounts[reason] += 1;
      else group.unknownCount += 1;
    }
  }
  for (const group of groups.values()) {
    // 「未说明」也算一种原因：一半有解释、一半没有时，逐条小徽标同样有用。
    const distinct = new Set(group.items.map((item) => item.reason ?? "unknown"));
    group.mixedReason = distinct.size > 1;
  }
  // Map 的插入顺序就是首次出现顺序，直接取值即可。
  return [...groups.values()];
}

/**
 * 3-A 决策表（唯一口径）：决定这一组该出哪个按钮。
 *
 * 1. 有 `entry_ids`（至少一个名字能定位到资料条目）**且**是自建板块 → `append`
 *    （确定性插入，不调模型）；
 * 2. `skills` / `languages` / `summary`（已有可写字段，改写就能补）→ `revise`
 *    （走既有修订弹窗）；
 * 3. 其余（条目级分区、以及没有 `entry_ids` 的旧记录自建板块）→ `workbench`
 *    （AI 修订只能改写已有内容，不能新增条目）。
 *
 * `canAppend = false` 表示宿主没有给出 `resumeId`/刷新回调：此时「补进简历」按钮点了
 * 也没法落库，降级成「去制作台添加」——它永远不会给出做不到的承诺。
 */
export function resolveCoverageAction(
  group: Pick<CoverageGroup, "section" | "rawSection" | "entryIds">,
  canAppend = true,
): CoverageAction {
  if (canAppend && group.entryIds.length > 0 && isCustomSection(group.rawSection)) {
    return "append";
  }
  if (AI_REWRITABLE_SECTIONS.has(group.section)) return "revise";
  return "workbench";
}

/**
 * 徽标口径：分区 `total` 求和（`names` 是展示用的截断列表），旧记录的纯文本警告按条计。
 * 两类都空时返回 0——调用方据此决定整块要不要渲染。
 */
export function coverageSummaryCount(
  notes: ResumeCoverageNote[],
  legacyWarnings: string[],
): number {
  return (
    groupCoverageNotes(notes).reduce((sum, group) => sum + group.total, 0) + legacyWarnings.length
  );
}
