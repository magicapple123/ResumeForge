// SPDX-License-Identifier: Apache-2.0
/**
 * 「文档大纲」（W06 / P1-01、D01）的**纯类型契约**：分组、选择、结构命令与结果。
 *
 * 这一层只依赖 `types/resume` 与 W00/W01 已冻结的稳定身份契约
 * （`features/resume-document/{types,identity}.ts`），不 import 任何组件或 React——
 * 面板、命令层、测试三处消费同一份定义，避免"面板里一套、保存时又一套"。
 *
 * ## 身份口径（W00 §3，不许在这里发明第二套）
 *
 * - 条目/要点都有可选稳定 id；排序**保留 id**，复制**生成新 id**；
 * - 命令里一律带 `objectId`（不是数组下标）：下标在拖动后会变，id 不会；
 * - 隐藏/锁定是条目上的可选布尔字段（W06-BE 契约），**取消时删键而不是写 `false`**，
 *   这样旧记录的内容指纹逐字节不变（见 `flags.ts`）。
 */
import type { MessageKey } from "../../i18n";
import type { ResumeContent } from "../../types/resume";
import type { EntryField } from "../resume-document/types";

export type { EntryField };

/** 大纲分组的键：个人信息 + 六类条目（顺序即左栏展示顺序）。 */
export type OutlineSectionKey = "personal" | EntryField;

export interface OutlineSectionMeta {
  key: OutlineSectionKey;
  /** `null` = 个人信息（标量字段，不是条目数组，不能排序/复制/隐藏）。 */
  field: EntryField | null;
  titleKey: MessageKey;
}

/** 六类条目的展示顺序与分组标题。 */
export const OUTLINE_SECTIONS: readonly OutlineSectionMeta[] = [
  { key: "personal", field: null, titleKey: "outline.section.personal" },
  { key: "education", field: "education", titleKey: "outline.section.education" },
  { key: "experience", field: "experience", titleKey: "outline.section.experience" },
  {
    key: "campus_experience",
    field: "campus_experience",
    titleKey: "outline.section.campus_experience",
  },
  { key: "projects", field: "projects", titleKey: "outline.section.projects" },
  { key: "skills", field: "skills", titleKey: "outline.section.skills" },
  { key: "awards", field: "awards", titleKey: "outline.section.awards" },
] as const;

/** 条目上的三个可选布尔字段（与后端 W06-BE 的 schema 同名）。 */
export type EntryFlag = "hidden" | "lock_content" | "lock_layout";

/** 读出来的布尔视图（字段缺失 = false）。 */
export interface EntryFlags {
  hidden: boolean;
  lockContent: boolean;
  lockLayout: boolean;
}

/** 一个被选中的对象。**锚点全是稳定 id**：排序后不必改选择，现算路径即可。 */
export type OutlineSelection =
  | { kind: "personal" }
  | { kind: "entry"; field: EntryField; objectId: string }
  | {
      kind: "point";
      field: EntryField;
      objectId: string;
      /** 要点所在数组字段（`description` / `highlights` …）。 */
      pointField: string;
      pointId: string;
    };

/** 命令里指向一个条目（按 id，不按下标）。 */
export interface OutlineEntryRef {
  field: EntryField;
  objectId: string;
}

/** 命令里指向一个要点（按 id + 它所在的数组字段，不按下标）。 */
export interface OutlinePointRef {
  /** 要点所在数组字段（`description` / `highlights` …）。 */
  pointField: string;
  pointId: string;
}

export type OutlineLockName = "content" | "layout";

/**
 * 结构命令：一次用户动作 = 一条命令（W03 统一历史直接把它当"一次可命名操作"）。
 *
 * `toIndex` 是**移动后的最终下标**（0-based）。命令执行器按 id 找到当前下标再移动，
 * 所以拖动过程中前面的移动不会让后面的命令指错对象。
 */
export type OutlineCommand =
  | { type: "reorder-entry"; field: EntryField; objectId: string; toIndex: number }
  | {
      type: "reorder-point";
      field: EntryField;
      objectId: string;
      pointField: string;
      pointId: string;
      toIndex: number;
    }
  | {
      /**
       * 要点**跨字段搬移**：把一条要点从 `fromPointField` 的数组搬到 `toPointField` 的
       * 目标位置（文本与 point id 一起搬，源数组搬空后保留 `[]`）。
       *
       * 纸面按字段渲染（`courses` 是行内「主修课程：…」，`achievements` 是项目符号），
       * 所以"跨字段互换"的正确语义就是"这一条随之变成目标字段的条目"。
       * `fromPointField === toPointField` 时它**等价于** `reorder-point`（同一份实现，
       * 见 `pointMove.ts`）——两条命令只差一个字段，不需要两套算法。
       */
      type: "move-point";
      field: EntryField;
      objectId: string;
      fromPointField: string;
      toPointField: string;
      pointId: string;
      /** 目标字段数组里的插入下标（0..目标数组长度，等于长度即追加到末尾）。 */
      toIndex: number;
    }
  | { type: "clone-entry"; field: EntryField; objectId: string }
  | {
      type: "clone-point";
      field: EntryField;
      objectId: string;
      pointField: string;
      pointId: string;
    }
  | { type: "set-hidden"; entries: readonly OutlineEntryRef[]; hidden: boolean }
  | {
      /**
       * 要点级显隐（W06 / `hidden_points`）：只在条目内按 point id 切换，不改条目本身的
       * `hidden`。数组变空时**删键**（与条目级 hidden 同一口径：旧内容指纹不变）。
       */
      type: "set-hidden-points";
      field: EntryField;
      objectId: string;
      points: readonly OutlinePointRef[];
      hidden: boolean;
    }
  | {
      type: "set-lock";
      field: EntryField;
      objectId: string;
      lock: OutlineLockName;
      value: boolean;
    };

/** 命令被拒绝的原因（UI 必须把它翻译成"给出路"的说明，不显示裸原因码）。 */
export type OutlineBlockReason = "locked-layout" | "locked-content" | "not-found";

/** 命令执行结果。`changed=false` 表示目标状态已成立（幂等），不是错误。 */
export type OutlineApplyResult =
  | { ok: true; content: ResumeContent; changed: boolean }
  | { ok: false; reason: OutlineBlockReason };

/**
 * 画布高亮目标：`prefix=true` 表示按 `path.` 前缀匹配（条目级，命中它下面所有字段/要点）。
 * 路径形态与后端模板的 `data-resume-path` 逐字一致（`experience.1.description.0`）。
 */
export interface OutlineHighlightTarget {
  path: string;
  prefix: boolean;
}

/** 面板内部的排序会话：Enter 确认前只预览顺序，不派发命令（Esc 直接丢弃）。 */
export interface OutlineSortSession {
  kind: "entry" | "point";
  field: EntryField;
  /** 被移动的条目 id；排序要点时它是要点所属条目。 */
  objectId: string;
  pointField?: string;
  pointId?: string;
  startIndex: number;
  currentIndex: number;
  total: number;
}
