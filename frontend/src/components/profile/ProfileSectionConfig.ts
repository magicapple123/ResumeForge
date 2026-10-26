// SPDX-License-Identifier: Apache-2.0
/**
 * 大字段的稳定顺序与兜底标签（F6）。
 *
 * 唯一真相在服务端：workspace.section_order（全局顺序）与 SectionOut.name（中文名）才是
 * 渲染依据；本文件的 DEFAULT_SECTION_ORDER 只是排序 store 的初始兜底（旧 8 项顺序），
 * 页面加载后立即被服务端顺序覆盖，**不是第二份定义清单**。
 *
 * 标签用 t() 从语言包取（不再在源码里写中文字面量），服务端 name 到达后以它为准。
 */
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";

/** 分区 key：内置 13 项 + 自建 custom:<section_id>，统一按不透明字符串处理。 */
export type ProfileSectionKey = string;

/** 拖拽激活阈值（像素）。 */
export const SECTION_DRAG_THRESHOLD_PX = 6;

/**
 * 排序 store 的初始兜底顺序（保留既有 8 项语义，旧排序用例依赖它）。
 * 资料页真正渲染一律以 GET /workspace 的 section_order（13 项 + 自建）为准。
 */
export const DEFAULT_SECTION_ORDER: string[] = [
  "basic_info",
  "educations",
  "experiences",
  "projects",
  "skills",
  "campus_experiences",
  "awards",
  "summary",
];

/** Fallback label keys. Resolve on property access so imports never freeze a language. */
const SECTION_LABEL_KEYS = new Map<string, MessageKey>([
  ["basic_info", "profileLibrary.sectionFallback.basic_info"],
  ["educations", "profileLibrary.sectionFallback.educations"],
  ["experiences", "profileLibrary.sectionFallback.experiences"],
  ["projects", "profileLibrary.sectionFallback.projects"],
  ["skills", "profileLibrary.sectionFallback.skills"],
  ["campus_experiences", "profileLibrary.sectionFallback.campus_experiences"],
  ["awards", "profileLibrary.sectionFallback.awards"],
  ["summary", "profileLibrary.sectionFallback.summary"],
  ["publications", "profileLibrary.sectionFallback.publications"],
  ["research_projects", "profileLibrary.sectionFallback.research_projects"],
  ["patents", "profileLibrary.sectionFallback.patents"],
  ["credentials", "profileLibrary.sectionFallback.credentials"],
  ["languages", "profileLibrary.sectionFallback.languages"],
]);

/** Fallback labels remain locale-aware for stores and helpers that import this module. */
export const SECTION_LABELS: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_target, property: string) => {
    const key = SECTION_LABEL_KEYS.get(property);
    return key ? t(key) : undefined;
  },
});

/**
 * 已退役的「补充事实」区块页内键（F6-C 会删除 facts 目录与所有引用）：
 * 保留导出只为让尚未同步的 facts 模块在迁移窗口内继续编译，新代码不得使用。
 * @deprecated 补充事实入口已下线（R-50/R-54），改用 13 个大字段与自建大字段。
 */
export const PROFILE_FACTS_SECTION_KEY = "profile_facts";

/**
 * 规范化为「basic_info 首位 + 服务端顺序 + 缺失项按兜底顺序补齐」。
 *
 * available 传当前活动分区 key（内置 + 自建）；服务端已经保证顺序，这里只防御
 * 旧备份/异常数据缺 basic_info 或含未知 key 的情况。
 */
export function normalizeSectionOrder(
  value: string[] | undefined,
  available: readonly string[] = DEFAULT_SECTION_ORDER,
): string[] {
  const supported = new Set(available);
  const seen = new Set<string>();
  const middle: string[] = [];
  for (const key of value ?? []) {
    if (key === "basic_info" || !supported.has(key) || seen.has(key)) continue;
    seen.add(key);
    middle.push(key);
  }
  const rest = available.filter((key) => key !== "basic_info" && !seen.has(key));
  return ["basic_info", ...middle, ...rest];
}
