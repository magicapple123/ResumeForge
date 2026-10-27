// SPDX-License-Identifier: Apache-2.0
/**
 * 知识库 / 资料箱内置分类的显示名。
 *
 * 值必须与 `types/knowledge.ts` 的 `KNOWLEDGE_CATEGORIES` 和 `types/material.ts` 的
 * `MATERIAL_CATEGORIES` **逐字相同**：它们同时是提交给后端、并作为筛选与分组键的协议值，
 * 所以中文界面的渲染结果与迁移前完全一致。英文显示名见 `en-US.enumsKnowledge.ts`；
 * 「协议值 → key」的映射表在 `i18n/enum/knowledge.ts`，渲染处再 `t()`。
 *
 * 用户自建分类是自由字符串，不在这张表里，显示时回退成原值。
 */
const enumsKnowledge = {
  // ── 知识库分类（KNOWLEDGE_CATEGORIES）────────────────────────
  "enumsKnowledge.category.knowledge.interviewNotes": "面经",
  "enumsKnowledge.category.knowledge.resumeTips": "简历技巧",
  "enumsKnowledge.category.knowledge.jobSearchStrategy": "求职策略",
  "enumsKnowledge.category.knowledge.interviewQa": "面试问答",
  "enumsKnowledge.category.knowledge.companyResearch": "公司信息",
  "enumsKnowledge.category.knowledge.industryKnowledge": "行业知识",
  "enumsKnowledge.category.knowledge.other": "其他",

  // ── 资料箱分类（MATERIAL_CATEGORIES）─────────────────────────
  "enumsKnowledge.category.material.certificates": "证书",
  "enumsKnowledge.category.material.workSamples": "作品",
  "enumsKnowledge.category.material.links": "链接",
  "enumsKnowledge.category.material.notes": "笔记",
  "enumsKnowledge.category.material.internshipDocuments": "实习材料",
  "enumsKnowledge.category.material.campusDocuments": "校园材料",
  "enumsKnowledge.category.material.other": "其他",
} as const;

export default enumsKnowledge;
