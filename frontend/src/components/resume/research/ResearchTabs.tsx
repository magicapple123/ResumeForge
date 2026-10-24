// SPDX-License-Identifier: Apache-2.0
/**
 * 三个科研页签的**装配出口**（W14）：wb-core 只需要把它展开进编辑器的 `tabItems`。
 *
 * ## 为什么提供工厂而不是让宿主自己拼
 *
 * 页签 key 必须与 content 的字段名**逐字一致**（`publications` / `research_projects` /
 * `patents`）：纸面点击（`data-resume-path="publications.0.title"`）要靠
 * `ResumeEditorTarget.TAB_BY_SECTION` 把 section 映射回页签；两边各写一份常量，
 * 改一个忘另一个就会出现"点纸面跳回基本信息页"。
 *
 * 所以 key 只在这里定义一次（`RESEARCH_TAB_KEYS`），宿主拿它去补映射表即可。
 */
import type { TabsProps } from "antd";
import PatentsEditor from "./PatentsEditor";
import PublicationsEditor from "./PublicationsEditor";
import ResearchProjectsEditor from "./ResearchProjectsEditor";
import { rt } from "../../../features/resume-research/i18n";

type TabItems = NonNullable<TabsProps["items"]>;

/** 三个页签 key = content 的三个字段名（顺序即页签顺序）。 */
export const RESEARCH_TAB_KEYS = ["publications", "research_projects", "patents"] as const;

/** 供 wb-core 展开进 `useResumeEditorPanel` 的 `tabItems`。 */
export function researchTabItems(): TabItems {
  return [
    {
      key: RESEARCH_TAB_KEYS[0],
      label: rt("research.tab.publications"),
      children: <PublicationsEditor />,
    },
    {
      key: RESEARCH_TAB_KEYS[1],
      label: rt("research.tab.projects"),
      children: <ResearchProjectsEditor />,
    },
    {
      key: RESEARCH_TAB_KEYS[2],
      label: rt("research.tab.patents"),
      children: <PatentsEditor />,
    },
  ];
}

export default researchTabItems;
