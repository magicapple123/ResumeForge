// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑器标签页的**装配出口**（F4 §5.6）：从 `useResumeEditorPanel` 等价拆出。
 *
 * 拆出的原因是预算：状态机已经贴着 500 行红线，而 F4 要加两个栏目（资格证照 / 自定义栏目）。
 * 页签 key 必须与 content 字段名一致（纸面点击定位依赖 `ResumeEditorTarget` 的映射）；
 * 科研三栏的 key 仍由 `ResearchTabs.RESEARCH_TAB_KEYS` 一处定义。
 *
 * ## 按当前组过滤（F9 / R1）
 *
 * 用户口径："我的资料里当前组有的内容才在新建简历界面显示输入框"。所以：
 *
 * - **当前组参与的**大字段 → 页签一定出现（即使还没有内容，用户要能在里面录入）；
 * - **当前组没有的**分区 → 页签不出现；
 * - **正文里已经有内容的**分区 → 页签永远保留（切组不能把已保存的正文从界面上藏起来，R-34）；
 * - 顺序尽量按当前组全局顺序（服务端 scope.participating_keys 已排序、basic_info 首位）。
 *
 * `participatingKeys` 缺省（旧宿主 / 夹具没给投影）时退回"显示全部页签"的旧行为——
 * 不知道当前组就不该猜，否则一次投影读取失败会让编辑器少掉一半页签。
 *
 * 过滤只依赖投影 scope 与正文内容，**不依赖表单里正在输入的值**：否则用户每打一个字
 * 页签都会重建（Tabs 的 items 引用变化 → 全部面板重渲染）。
 */
import type { TabsProps } from "antd";
import type { ReactNode } from "react";
import type { EditorView } from "../../features/profile-library/types";
import { t } from "../../i18n";
import type { ResumeContent } from "../../types";
import CredentialsEditor from "../resume/CredentialsEditor";
import ResumeBasicInfoTab from "../resume/ResumeBasicInfoTab";
import { RESEARCH_TAB_KEYS, researchTabItems } from "../resume/research/ResearchTabs";
import CustomSectionsEditor from "./CustomSectionsEditor";
import LanguageEditor from "./LanguageEditor";
import {
  AwardEditor,
  CampusEditor,
  EducationEditor,
  ExperienceEditor,
  ProjectEditor,
  SkillEditor,
} from "./ResumeSectionEditors";

export interface ResumeEditorTabsOptions {
  /** 资料里的个人总结（决定「填入个人总结」是否出现）。 */
  summarySource: string;
  fillSummary: () => void;
  /** 内容里的自建大字段数量：未知当前组时据此决定「自定义栏目」页签（旧行为）。 */
  customSectionCount?: number;
  /**
   * 当前组参与清单（投影的 `scope.participating_keys`，已按全局顺序）。
   * 缺省 = 还不知道当前组 → 不过滤（旧行为）。
   */
  participatingKeys?: readonly string[];
  /** 正文：已有内容的分区永远保留页签（防切组丢已保存正文，R-34）。 */
  content?: ResumeContent | null;
  /**
   * 「有没有内容」的掩码（见 `tabContentPresenceMask`）：正文与表单当前值的并集。
   *
   * 表单里刚加、还没保存的条目也算"有内容"——否则切组把那一栏藏起来，用户刚写的东西
   * 会从界面上消失。传字符串而不是对象：宿主每次按键都能算出同一个掩码，页签不会重建。
   */
  contentPresenceMask?: string;
  /**
   * 编辑器视图（F10）：板块清单与顺序的来源。
   *
   * 新简历 = 当前方案投影；已保存简历 = 创建时冻结的快照（方案后来再改也不影响它）。
   * 缺省回退到 `participatingKeys`（旧宿主/旧测试），两者都没有时显示完整规范列表。
   */
  editorView?: EditorView | null;
}

/** 一个页签 + 它和"资料分区 / 正文字段"的关系。 */
interface EditorTabSpec {
  key: string;
  label?: ReactNode;
  /** 正文里的数组字段；`undefined` 表示这个页签不是"有内容才保留"的列表分区。 */
  contentField?: keyof ResumeContent;
  children: ReactNode;
}

/**
 * 资料分区键 → 页签 key（**唯一**一份映射）。
 *
 * 与 `ResumeEditorTarget.TAB_BY_SECTION` 不是同一张表：那张表的键是**正文数组字段名**
 * （education/projects/…），这里的是投影的**消费分区键**（educations/projects/…）。
 * basic_info 与 summary 同属「基本信息」；languages 自 2026-10 起是独立页签（不再落到技能）。
 */
const TAB_KEY_BY_PROFILE_SECTION: Record<string, string> = {
  basic_info: "basic",
  summary: "basic",
  educations: "education",
  experiences: "experience",
  campus_experiences: "campus",
  projects: "projects",
  skills: "skills",
  // 2026-10：语言能力独立成栏（不再是「专业技能」页签的一部分，用户反馈 #11）。
  languages: "languages",
  awards: "awards",
  publications: "publications",
  research_projects: "research_projects",
  patents: "patents",
  credentials: "credentials",
};

/**
 * 页签"保留"判据覆盖的正文数组字段（顺序即 `tabContentPresenceMask` 的位序）。
 * 与各页签的 `contentField` 一一对应；新增可编辑栏目时两处一起加。
 */
export const EDITOR_TAB_CONTENT_FIELDS = [
  "education",
  "experience",
  "campus_experience",
  "projects",
  "skills",
  "languages",
  "awards",
  "publications",
  "research_projects",
  "patents",
  "credentials",
  "custom_sections",
] as const satisfies readonly (keyof ResumeContent)[];

const CONTENT_FIELD_INDEX: Record<string, number> = Object.fromEntries(
  EDITOR_TAB_CONTENT_FIELDS.map((field, index) => [field, index]),
);

function hasListValue(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

/**
 * 合并"正文里有"与"表单当前值里有"的掩码（"1"/"0" 逐字段拼接）。
 *
 * 只让宿主在掩码变化时才重建页签：用户每打一个字 `formValues` 都会变，但它不会改变
 * 任何分区的"有/无"，掩码字符串因此保持不变（`useMemo` 的依赖可以按它写）。
 */
export function tabContentPresenceMask(
  content: ResumeContent | null | undefined,
  formValues: ResumeContent | null | undefined,
): string {
  return EDITOR_TAB_CONTENT_FIELDS.map((field) =>
    hasListValue(content?.[field]) || hasListValue(formValues?.[field]) ? "1" : "0",
  ).join("");
}

/** 当前组参与清单里的分区键对应哪个页签；自建分区（custom:）统一进「自定义栏目」。 */
function tabKeyForProfileSection(sectionKey: string): string | null {
  if (sectionKey.startsWith("custom:")) return "custom-sections";
  return TAB_KEY_BY_PROFILE_SECTION[sectionKey] ?? null;
}

/** 标准页签的规范顺序（不含自建栏目：它按条件追加）。 */
function buildTabSpecs(summarySource: string, fillSummary: () => void): EditorTabSpec[] {
  const research = researchTabItems();
  return [
    {
      key: "basic",
      label: t("editor.tab.basic"),
      children: <ResumeBasicInfoTab summarySource={summarySource} onFillSummary={fillSummary} />,
    },
    {
      key: "education",
      label: t("editor.tab.education"),
      contentField: "education",
      children: <EducationEditor />,
    },
    {
      key: "experience",
      label: t("editor.tab.experience"),
      contentField: "experience",
      children: <ExperienceEditor />,
    },
    {
      key: "campus",
      label: t("editor.tab.campus"),
      contentField: "campus_experience",
      children: <CampusEditor />,
    },
    {
      key: "projects",
      label: t("editor.tab.projects"),
      contentField: "projects",
      children: <ProjectEditor />,
    },
    {
      key: "skills",
      label: t("editor.tab.skills"),
      contentField: "skills",
      children: <SkillEditor />,
    },
    {
      key: "languages",
      label: t("editor.section.languages"),
      contentField: "languages",
      children: <LanguageEditor />,
    },
    {
      key: "awards",
      label: t("editor.tab.awards"),
      contentField: "awards",
      children: <AwardEditor />,
    },
    // W14 科研三页签（论文 / 科研项目 / 专利）：key 与 content 字段名逐字一致。
    ...RESEARCH_TAB_KEYS.map((key, index) => ({
      key,
      label: research[index]?.label,
      contentField: key as keyof ResumeContent,
      children: research[index]?.children,
    })),
    // A4 资格证照：后端类型早已存在，F4 补齐编辑槽（证号默认不存在于内容里）。
    {
      key: "credentials",
      label: t("editor.tab.credentials"),
      contentField: "credentials",
      children: <CredentialsEditor />,
    },
  ];
}

/** 自建栏目页签：只在方案有自建板块或正文里已有自建分区时出现。 */
function buildCustomSectionsTab(label: ReactNode): EditorTabSpec {
  return {
    key: "custom-sections",
    label,
    contentField: "custom_sections",
    children: <CustomSectionsEditor />,
  };
}

/** 这个页签对应的正文数组里有没有内容（自建栏目同样按 custom_sections 判断）。 */
function hasTabContent(
  spec: EditorTabSpec,
  content: ResumeContent | null | undefined,
  contentPresenceMask: string | undefined,
): boolean {
  if (!spec.contentField) return false;
  const index = CONTENT_FIELD_INDEX[spec.contentField];
  if (index !== undefined && contentPresenceMask !== undefined) {
    return contentPresenceMask[index] === "1";
  }
  return hasListValue(content?.[spec.contentField]);
}

export function buildResumeEditorTabItems({
  summarySource,
  fillSummary,
  customSectionCount = 0,
  participatingKeys,
  content,
  contentPresenceMask,
  editorView = null,
}: ResumeEditorTabsOptions): NonNullable<TabsProps["items"]> {
  const standardSpecs = buildTabSpecs(summarySource, fillSummary);
  const viewSections = editorView?.sections ?? [];
  const hasEditorView = viewSections.length > 0;
  // 方案里的自建板块不再是"一个泛称页签"：名字是用户自己起的（如 22333），页签直接用它。
  const customNames = viewSections
    .filter((section) => section.key.startsWith("custom:"))
    .map((section) => section.name);
  const customSpec = buildCustomSectionsTab(
    customNames.length > 0 ? customNames.join(" / ") : t("editor.tab.custom-sections"),
  );
  const allSpecs = [...standardSpecs, customSpec];
  const byKey = new Map(allSpecs.map((spec) => [spec.key, spec]));

  const ordered: EditorTabSpec[] = [];
  const push = (key: string | null): void => {
    if (key === null) return;
    const spec = byKey.get(key);
    // 只有一份列表 + 一次去重：任何"某个页签被加两遍"的路径都会在这里被吃掉。
    if (spec && !ordered.some((item) => item.key === spec.key)) ordered.push(spec);
  };

  const participating = participatingKeys ?? null;
  if (hasEditorView) {
    // 视图的板块顺序就是页签顺序（服务端已按全局顺序排好，basic_info 在首位）。
    for (const section of viewSections) push(tabKeyForProfileSection(section.key));
  } else if (participating === null) {
    // 不知道当前方案：保持完整的规范列表（旧行为）。
    for (const spec of standardSpecs) push(spec.key);
  } else {
    // 当前方案的全局顺序就是页签顺序（服务端已把 basic_info 排首位）。
    for (const sectionKey of participating) push(tabKeyForProfileSection(sectionKey));
  }

  // 已有内容的分区永远保留页签：切组只影响"能新增什么"，不能把已保存的正文藏起来。
  for (const spec of allSpecs) {
    if (hasTabContent(spec, content, contentPresenceMask)) push(spec.key);
  }

  // 基本信息恒参与（R-21）；服务端一定给，这里只是防御异常投影/旧 mock 把页签全藏掉。
  push("basic");

  // 自建栏目：方案里有自建板块时即使正文还没内容也要有录入入口；
  // 没有视图也没有参与清单时沿用旧判据（正文里已有自建分区才出现）。
  if (hasEditorView) {
    if (viewSections.some((section) => section.key.startsWith("custom:"))) push("custom-sections");
  } else if (participating === null) {
    if (customSectionCount > 0) push("custom-sections");
  } else if (participating.some((sectionKey) => sectionKey.startsWith("custom:"))) {
    push("custom-sections");
  }

  return ordered.map((spec) => ({ key: spec.key, label: spec.label, children: spec.children }));
}
