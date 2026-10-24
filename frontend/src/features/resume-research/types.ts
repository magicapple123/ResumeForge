// SPDX-License-Identifier: Apache-2.0
/**
 * 科研三栏（论文 / 科研项目 / 专利）的类型出口（W14 / P2-02）。
 *
 * 类型本体已由 lead 登记在 `types/resumeContent.ts`（契约 §5.2 的字段形状）。本文件只做两件事：
 *
 * 1. **re-export**：组件与测试统一从 `features/resume-research/types` 取类型，将来类型搬家
 *    （比如再拆一个文件）只改这里一行；
 * 2. 收口本域自己的键类型 `ResearchSectionKey`。
 *
 * ## 与后端逐字对齐的三条（读实现前先看）
 *
 * 1. `status` 是**事实锁字段**：AI 改写不得提升（在投 ≠ 已发表）。
 * 2. 作者/发明人是**数组 + 下标即顺序**，不存 order 字段；`is_self` 标本人、
 *    `corresponding` 标通讯作者（前端只负责展示与写入，不在这里推导）。
 * 3. `ResumeContent` 上的三个字段是**可选**的（旧记录 / fixture 没有它们）：
 *    读取侧一律 `content.publications ?? []` 兜底，不补空数组写回内容。
 */
export type {
  ResumeAuthor,
  ResumePatent,
  ResumePatentStatus,
  ResumePublication,
  ResumePublicationStatus,
  ResumeResearchProject,
} from "../../types/resumeContent";

/** 三类科研栏目在内容里的键（与后端 `ResumeContent` 的字段名逐字一致）。 */
export type ResearchSectionKey = "publications" | "research_projects" | "patents";
