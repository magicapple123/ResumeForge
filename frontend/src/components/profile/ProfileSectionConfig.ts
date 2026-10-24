// SPDX-License-Identifier: Apache-2.0
/** 个人资料大分区的稳定顺序、标签和归一化规则。 */

export type ProfileSectionKey =
  | "basic_info"
  | "educations"
  | "experiences"
  | "campus_experiences"
  | "projects"
  | "skills"
  | "awards"
  | "summary";

/**
 * 资料大分区的默认顺序（2026-10 起，与简历正文默认顺序同一口径）。
 *
 * 这是**有意的产品决策**，不是随手排列：默认值唯一的可见语义是"新建资料 / 新建简历
 * 长什么样"。校招场景下读者先确认学历与专业，再往工作与项目看，所以教育经历排在最前；
 * 「个人总结」是概括性文字，读完经历再看更顺，排在最后。后端 `PROFILE_SECTION_KEYS`
 * 必须与本数组逐项一致（`PROFILE_SECTION_KEYS` 决定旧数据缺失分区时的补位顺序）。
 *
 * 只改默认值：用户资料里已有的 `section_order` 是显式 JSON，不得迁移或覆盖。
 */
export const DEFAULT_SECTION_ORDER: ProfileSectionKey[] = [
  "basic_info",
  "educations",
  "experiences",
  "projects",
  "skills",
  "campus_experiences",
  "awards",
  "summary",
];

export const SECTION_DRAG_THRESHOLD_PX = 6;

export const SECTION_LABELS: Record<ProfileSectionKey, string> = {
  basic_info: "基本信息",
  educations: "教育经历",
  experiences: "实习/工作经历",
  campus_experiences: "校园经历",
  projects: "项目经历",
  skills: "专业技能",
  awards: "荣誉奖项",
  summary: "个人总结 / 自我评价",
};

export function normalizeSectionOrder(value: string[] | undefined): ProfileSectionKey[] {
  const supported = new Set<ProfileSectionKey>(DEFAULT_SECTION_ORDER);
  const normalized = (value ?? []).filter(
    (key): key is ProfileSectionKey =>
      key !== "basic_info" && supported.has(key as ProfileSectionKey),
  );
  return [
    "basic_info",
    ...normalized,
    ...DEFAULT_SECTION_ORDER.filter((key) => key !== "basic_info" && !normalized.includes(key)),
  ];
}
