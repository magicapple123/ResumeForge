// SPDX-License-Identifier: Apache-2.0
/** 将预览中的结构化字段路径映射到编辑器标签和表单字段。 */

const TAB_BY_SECTION: Record<string, string> = {
  education: "education",
  experience: "experience",
  campus_experience: "campus",
  projects: "projects",
  skills: "skills",
  awards: "awards",
  // W14：科研三栏的 key 与 content 字段名一致（见 ResearchTabs.RESEARCH_TAB_KEYS）。
  publications: "publications",
  research_projects: "research_projects",
  patents: "patents",
  // F4：资格证照与自建栏目（C2）各有独立页签；纸面点击定位必须落到它们上。
  credentials: "credentials",
  custom_sections: "custom-sections",
};

const MULTILINE_FIELDS = new Set([
  "courses",
  "achievements",
  "description",
  "tech_stack",
  "highlights",
]);

export function resolveEditorTarget(path: string): { tab: string; name: (string | number)[] } {
  const parts = path
    .split(".")
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const section = typeof parts[0] === "string" ? parts[0] : "";
  const lastPart = parts[parts.length - 1];
  const lastField = parts[parts.length - 2];
  // 预览中的数组要点各有独立路径，但编辑器以一个多行文本框维护整个数组。
  if (
    typeof lastPart === "number" &&
    typeof lastField === "string" &&
    MULTILINE_FIELDS.has(lastField)
  ) {
    parts.pop();
  }
  return { tab: TAB_BY_SECTION[section] ?? "basic", name: parts };
}
