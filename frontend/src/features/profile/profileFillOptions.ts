// SPDX-License-Identifier: Apache-2.0
/**
 * 「从我的资料填入」的候选数据（F4 §5.4，纯函数，便于单测）。
 *
 * **输入是服务端投影（PaperProjectionOut），不是旧 Profile**：候选必须只来自当前组
 * （C），而且"追加这一条"必须追加与纸面完全相同的那个 content 条目——服务端已经用
 * `paper_content_path` 指明它在 `content` 里的位置，前端按路径取现成对象即可，
 * **禁止按标题猜**（R-37 单源、R-16）。承载区「标签：值」也早已由服务端拼好，
 * 前端不重新拼任何标签。
 *
 * 候选身份用 `entry_id`（改过分数学分、补过描述仍是同一条资料）；`matchKey` 是
 * 形状键，只用来和"表单里已经有的条目"比对（用户可能手抄过同样的内容）。
 */
import type {
  EditorView,
  PaperProjectionOut,
  ProjectionCandidateOut,
} from "../profile-library/types";
import { editorViewFromSchema } from "./editorView";
import type {
  ResumeAward,
  ResumeCampusExperience,
  ResumeContent,
  ResumeEducation,
  ResumeExperience,
  ResumeProject,
  ResumeSkill,
} from "../../types";

/** 下拉里的一条候选。`value` 直接就是表单里那一条的形状（来自投影 content）。 */
export interface ProfileFillItem {
  /** 稳定身份：当前组里那条资料的 entry_id（去重/禁用判定用）。 */
  key: string;
  /** 下拉里显示的主标题。 */
  label: string;
  /** 次要说明（时间、角色等），可为空。 */
  hint?: string;
  /** 原样写进表单数组的那一条（服务端投影 content 里的现成对象）。 */
  value: unknown;
  /**
   * 与表单现有条目比对用的形状键（详见各 `*FillKey`）。
   * 可选：既有测试夹具只给 `key` 时退回 `key` 比对。
   */
  matchKey?: string;
}

/** 六个列表模块的候选 + 个人总结（基本信息里唯一能被"填入"的字段）。 */
export interface ProfileFillSources {
  education: ProfileFillItem[];
  experience: ProfileFillItem[];
  campusExperience: ProfileFillItem[];
  projects: ProfileFillItem[];
  skills: ProfileFillItem[];
  awards: ProfileFillItem[];
  /**
   * 扩展分区候选（任务 #9）：科研三栏 / 证照 / 语言能力也要支持「从资料填入本条」。
   *
   * **可选**：旧宿主 / 旧夹具没给时按"没有候选"处理（入口不渲染），既有用例语义不变。
   * 自建板块刻意不在这里：它的正文形状是 {text, lines}，没有"字段"可只填空字段，
   * 硬填会覆盖用户的标签行，所以不提供该入口。
   */
  publications?: ProfileFillItem[];
  researchProjects?: ProfileFillItem[];
  patents?: ProfileFillItem[];
  credentials?: ProfileFillItem[];
  languages?: ProfileFillItem[];
  /** 资料里的个人总结；空串表示没写过。 */
  summary: string;
  /**
   * 当前组参与的大字段 key（按全局顺序，服务端 scope.participating_keys）。
   *
   * 与候选同源、一起返回是刻意的：编辑器页签的过滤规则就是"当前组有什么就显示什么"，
   * 两处各取一次投影会出现"页签按新组刷新了、候选还是旧组"的中间态。缺省（旧宿主/
   * 夹具没给）表示**还不知道当前组**——此时退回显示全部页签（旧行为），不做过滤。
   */
  participatingKeys?: string[];
  /**
   * 编辑器视图（F10）：新简历 = 当前方案投影冻结的板块/字段可见性；已保存简历由宿主用
   * 创建时的快照覆盖（见 `withSavedResumeEditorView`）。缺省 = 不知道方案 → 页签不过滤。
   */
  editorView?: EditorView;
}

/**
 * 列表模块名：`ResumeListSection` 用它挑候选，`ResumeEditorModal` 用它做类型约束。
 *
 * 显式列出而不是从 `keyof ProfileFillSources` 推导：`participatingKeys` 与 summary 一样
 * 不是"可填入的分区"，漏排一次就会让 `PROFILE_FILL_KEYS` 多出一个没有键函数的成员。
 */
export type ProfileFillSection =
  | "education"
  | "experience"
  | "campusExperience"
  | "projects"
  | "skills"
  | "awards"
  | "publications"
  | "researchProjects"
  | "patents"
  | "credentials"
  | "languages";

/** 统一取值：非字符串（表单里可能是 undefined）当成空串，并折叠多余空白。 */
function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** 把若干片段拼成去重键；空片段保留位置，保证不同字段数的键不会互相撞。 */
function joinKey(parts: unknown[]): string {
  return parts.map(text).join("|");
}

/** 整条都没写内容时键里不会有任何非分隔符字符。 */
function isBlankKey(key: string): boolean {
  return key.split("|").every((part) => part.length === 0);
}

/** 教育：`school|major|start|end`。 */
export function educationFillKey(item: Partial<ResumeEducation> | null | undefined): string {
  return joinKey([item?.school, item?.major, item?.start_date, item?.end_date]);
}

/** 实习/工作：`company|role|start|end`。 */
export function experienceFillKey(item: Partial<ResumeExperience> | null | undefined): string {
  return joinKey([item?.company, item?.role, item?.start_date, item?.end_date]);
}

/** 校园经历：`organization|role`（同一组织同一职务只算一条）。 */
export function campusExperienceFillKey(
  item: Partial<ResumeCampusExperience> | null | undefined,
): string {
  return joinKey([item?.organization, item?.role]);
}

/** 项目：`name`（项目名是最能认出"同一条"的字段）。 */
export function projectFillKey(item: Partial<ResumeProject> | null | undefined): string {
  return joinKey([item?.name]);
}

/** 技能：`name`（同名技能只该出现一次）。 */
export function skillFillKey(item: Partial<ResumeSkill> | null | undefined): string {
  return joinKey([item?.name]);
}

/** 荣誉：`name|date`（同名奖项每届各一条，日期是区分它们的依据）。 */
export function awardFillKey(item: Partial<ResumeAward> | null | undefined): string {
  return joinKey([item?.name, item?.date]);
}

/** 论文：`title`（标题是认出"同一条"最稳的字段）。 */
export function publicationFillKey(item: { title?: string } | null | undefined): string {
  return joinKey([item?.title]);
}

/** 科研项目：`name`。 */
export function researchProjectFillKey(item: { name?: string } | null | undefined): string {
  return joinKey([item?.name]);
}

/** 专利：`title`。 */
export function patentFillKey(item: { title?: string } | null | undefined): string {
  return joinKey([item?.title]);
}

/** 证照：`name`。 */
export function credentialFillKey(item: { name?: string } | null | undefined): string {
  return joinKey([item?.name]);
}

/** 语言能力：`name`（英语 / 日语…）。 */
export function languageFillKey(item: { name?: string } | null | undefined): string {
  return joinKey([item?.name]);
}

/** 各模块的形状键实现，供 `ResumeListSection` / `ResearchListSection` 计算"已加入"集合时复用。 */
export const PROFILE_FILL_KEYS: Record<ProfileFillSection, (item: unknown) => string> = {
  education: (item) => educationFillKey(item as Partial<ResumeEducation>),
  experience: (item) => experienceFillKey(item as Partial<ResumeExperience>),
  campusExperience: (item) => campusExperienceFillKey(item as Partial<ResumeCampusExperience>),
  projects: (item) => projectFillKey(item as Partial<ResumeProject>),
  skills: (item) => skillFillKey(item as Partial<ResumeSkill>),
  awards: (item) => awardFillKey(item as Partial<ResumeAward>),
  publications: (item) => publicationFillKey(item as { title?: string }),
  researchProjects: (item) => researchProjectFillKey(item as { name?: string }),
  patents: (item) => patentFillKey(item as { title?: string }),
  credentials: (item) => credentialFillKey(item as { name?: string }),
  languages: (item) => languageFillKey(item as { name?: string }),
};

/** 消费分区键 → 简历正文数组字段 + 下拉模块名；自建板块的正文是 {text, lines}，不进填入下拉。 */
const SECTION_BY_CONSUMED_KEY: Record<
  string,
  { contentField: keyof ResumeContent; section: ProfileFillSection }
> = {
  educations: { contentField: "education", section: "education" },
  experiences: { contentField: "experience", section: "experience" },
  campus_experiences: { contentField: "campus_experience", section: "campusExperience" },
  projects: { contentField: "projects", section: "projects" },
  skills: { contentField: "skills", section: "skills" },
  awards: { contentField: "awards", section: "awards" },
  publications: { contentField: "publications", section: "publications" },
  research_projects: { contentField: "research_projects", section: "researchProjects" },
  patents: { contentField: "patents", section: "patents" },
  credentials: { contentField: "credentials", section: "credentials" },
  languages: { contentField: "languages", section: "languages" },
};

/** 简历正文数组字段名 → 填入模块名（通用列表容器按 Form.List 的 name 直接取候选）。 */
export const PROFILE_FILL_SECTION_BY_CONTENT_FIELD: Record<string, ProfileFillSection> = {
  education: "education",
  experience: "experience",
  campus_experience: "campusExperience",
  projects: "projects",
  skills: "skills",
  awards: "awards",
  publications: "publications",
  research_projects: "researchProjects",
  patents: "patents",
  credentials: "credentials",
  languages: "languages",
};

/** 按服务端给的 paper_content_path（如 `projects/2`）取 content 里的现成条目。 */
function contentEntryAt(content: ResumeContent, path: string): Record<string, unknown> | null {
  const [field, indexText] = path.split("/");
  if (!field || indexText === undefined) return null;
  const list = (content as unknown as Record<string, unknown>)[field];
  const index = Number(indexText);
  if (!Array.isArray(list) || !Number.isInteger(index) || index < 0) return null;
  const value = list[index];
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function describeCandidate(candidate: ProjectionCandidateOut): { label: string; hint?: string } {
  const label = text(candidate.title);
  const hint = text(candidate.subtitle);
  return hint ? { label, hint } : { label };
}

function buildBucket(
  projection: PaperProjectionOut,
  section: ProfileFillSection,
  contentField: keyof ResumeContent,
): ProfileFillItem[] {
  const seen = new Set<string>();
  const items: ProfileFillItem[] = [];
  // 运行时防御：投影端点被旧 mock / 旧后端按非投影形状返回时，降级成"没有候选"，
  // 绝不把异常抛进编辑器渲染（否则一次资料读取失败会连带打不开简历）。
  const candidates = Array.isArray(projection?.candidates) ? projection.candidates : [];
  for (const candidate of candidates) {
    const rule = SECTION_BY_CONSUMED_KEY[candidate.section_key];
    if (!rule || rule.section !== section || rule.contentField !== contentField) continue;
    const value = contentEntryAt(projection.content, candidate.paper_content_path);
    if (value === null) continue; // 空条目在投影里没有位置：没有可追加的东西
    const matchKey = PROFILE_FILL_KEYS[section](value);
    if (isBlankKey(matchKey)) continue;
    const identity = text(candidate.entry_id) || matchKey;
    if (seen.has(identity)) continue;
    seen.add(identity);
    items.push({ key: identity, ...describeCandidate(candidate), value, matchKey });
  }
  return items;
}

/** 某个来源分区（服务端 source_layout 的行）对应的一组候选；供新建流程的 13 来源面板用。 */
export interface ProjectionSectionFill {
  /** 简历正文字段（= 编辑器表单里的数组名）。 */
  contentField: keyof ResumeContent;
  section: ProfileFillSection;
  items: ProfileFillItem[];
}

/** 按消费分区键（educations/projects/…）取该分区的可追加候选；非追加类分区返回 null。 */
export function projectionSectionFill(
  projection: PaperProjectionOut,
  sectionKey: string,
): ProjectionSectionFill | null {
  const rule = SECTION_BY_CONSUMED_KEY[sectionKey];
  if (!rule) return null;
  return {
    contentField: rule.contentField,
    section: rule.section,
    items: buildBucket(projection, rule.section, rule.contentField),
  };
}

/**
 * 从**当前组投影**造出各模块的填入候选。
 *
 * 顺序沿用 candidates（= 全局顺序 + 条目 sort_order），前端不再排序；每条 `value` 都是
 * 投影 content 里的现成对象，与纸面逐字相同，所以"填入"就是一次 `[...current, value]`。
 * 科研三栏 / 证照 / 语言能力从 2026-10 起也进"从资料填入本条"（任务 #9）：每条都能从
 * 当前组资料里把空字段补齐，不再需要板块级的"追加一条"入口。
 * 自建板块不提供候选：正文形状是 {text, lines}，没有"字段"可只填空字段。
 */
export function buildProfileFillSources(projection: PaperProjectionOut): ProfileFillSources {
  const content = projection?.content;
  // 参与清单与候选同源（见 participatingKeys 的注释）；旧夹具没有 scope 时保持 undefined，
  // 让编辑器退回"不过滤"的旧行为，而不是把页签全藏掉。
  const scopeKeys = projection?.scope?.participating_keys;
  const participatingKeys = Array.isArray(scopeKeys) ? [...scopeKeys] : undefined;
  const editorView = editorViewFromSchema(projection?.editor_schema);
  if (!content) {
    return {
      education: [],
      experience: [],
      campusExperience: [],
      projects: [],
      skills: [],
      awards: [],
      publications: [],
      researchProjects: [],
      patents: [],
      credentials: [],
      languages: [],
      summary: "",
      ...(participatingKeys ? { participatingKeys } : {}),
      ...(editorView ? { editorView } : {}),
    };
  }
  return {
    education: buildBucket(projection, "education", "education"),
    experience: buildBucket(projection, "experience", "experience"),
    campusExperience: buildBucket(projection, "campusExperience", "campus_experience"),
    projects: buildBucket(projection, "projects", "projects"),
    skills: buildBucket(projection, "skills", "skills"),
    awards: buildBucket(projection, "awards", "awards"),
    publications: buildBucket(projection, "publications", "publications"),
    researchProjects: buildBucket(projection, "researchProjects", "research_projects"),
    patents: buildBucket(projection, "patents", "patents"),
    credentials: buildBucket(projection, "credentials", "credentials"),
    languages: buildBucket(projection, "languages", "languages"),
    summary: text(content.summary),
    ...(participatingKeys ? { participatingKeys } : {}),
    ...(editorView ? { editorView } : {}),
  };
}
