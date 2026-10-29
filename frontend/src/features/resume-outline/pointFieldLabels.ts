// SPDX-License-Identifier: Apache-2.0
/**
 * 要点行的**字段归属标签**：一个条目的要点可能来自多个数组
 * （教育经历的 `courses` + `achievements`、项目的 `tech_stack` + `description` + `highlights`），
 * 大纲把它们拼成一条扁平列表展示，四行长得一模一样——不标出字段归属，用户看不出
 * "第一条其实是课程行"，跨字段搬移之后"搬走的是哪一条"也就无从判断。
 *
 * ## 文案来源（不新造词）
 *
 * 全部复用编辑器表单里**同一个字段**已经在用的 `editor.field.*`：用户在中栏表单里看到的词
 * 与大纲行上的标签必须是同一个词，否则同一个字段有了两个名字。
 * `description` 按分区取不同标签（工作内容 / 校园经历描述 / 项目描述）——表单里本来就分开。
 *
 * ## 边界
 *
 * - 查不到映射 → **不显示标签**（`null`）。绝不回退成 `pointField` 原始键名
 *   （界面上出现 `manual_page_break` 这类机器码是既有教训），也不回退英文机器码。
 * - 这张表不新增任何 i18n 词条：`zh-CN` / `en-US` 都已经有同键。
 */
import type { MessageKey } from "../../i18n";
import type { OutlinePoint } from "./model";
import type { EntryField } from "./types";

/** `(分区字段, 要点数组字段) → i18n key`。未登记的字段不显示标签。 */
export const POINT_FIELD_LABEL_KEYS: Record<EntryField, Record<string, MessageKey>> = {
  education: {
    courses: "editor.field.courses",
    achievements: "editor.field.studyAchievements",
  },
  experience: { description: "editor.field.expDescription" },
  campus_experience: { description: "editor.field.campusDescription" },
  projects: {
    tech_stack: "editor.field.techStack",
    description: "editor.field.projectDescription",
    highlights: "editor.field.highlights",
  },
  skills: {},
  awards: {},
};

/** 某个要点字段的标签文案 key；未登记返回 `null`（= 这一行不显示标签）。 */
export function pointFieldLabelKey(field: EntryField, pointField: string): MessageKey | null {
  return POINT_FIELD_LABEL_KEYS[field][pointField] ?? null;
}

/**
 * 这个条目要不要给要点行标字段归属：**非空**要点字段 ≥2。
 *
 * `pointsOf` 已经跳过空数组，所以直接数 `points` 里出现过几个字段即可。只有 1 个字段时
 * 标签是纯噪音（每行都写「工作内容」没有任何信息量）。
 */
export function needsPointFieldTags(entry: { points: readonly OutlinePoint[] } | null): boolean {
  if (!entry) return false;
  const fields = new Set<string>();
  for (const point of entry.points) fields.add(point.pointField);
  return fields.size >= 2;
}

/**
 * 每个字段**第一条**要点的 id（标签只挂在这一条上）。
 *
 * 为什么不每行都标：同组连续三行都写「在校成果」既啰嗦又抢正文的视线；用户只需要
 * "一眼看出上面那条属于另一类"。要点顺序里同一字段是连续的（模型按字段声明顺序拼扁平列表，
 * 搬移也只会在组内或组边界插入），所以"每组第一条"就是那条组首行。
 */
export function pointFieldGroupLeaders(points: readonly OutlinePoint[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const leaders = new Set<string>();
  for (const point of points) {
    if (seen.has(point.pointField)) continue;
    seen.add(point.pointField);
    if (point.pointId) leaders.add(point.pointId);
  }
  return leaders;
}
