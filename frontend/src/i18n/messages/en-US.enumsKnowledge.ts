// SPDX-License-Identifier: Apache-2.0
/**
 * Display names for the built-in knowledge-base and material-library categories.
 *
 * The protocol values live in `types/knowledge.ts` (`KNOWLEDGE_CATEGORIES`) and
 * `types/material.ts` (`MATERIAL_CATEGORIES`): they are sent to the backend and used as
 * filter and grouping keys, so they never change. The value-to-key mapping lives in
 * `i18n/enum/knowledge.ts` and is resolved with `t()` at render time.
 *
 * User-created categories are free strings; they are shown as-is.
 */
const enumsKnowledge = {
  // Knowledge categories (KNOWLEDGE_CATEGORIES)
  "enumsKnowledge.category.knowledge.interviewNotes": "Interview notes",
  "enumsKnowledge.category.knowledge.resumeTips": "Resume tips",
  "enumsKnowledge.category.knowledge.jobSearchStrategy": "Job search strategy",
  "enumsKnowledge.category.knowledge.interviewQa": "Interview Q&A",
  "enumsKnowledge.category.knowledge.companyResearch": "Company research",
  "enumsKnowledge.category.knowledge.industryKnowledge": "Industry knowledge",
  "enumsKnowledge.category.knowledge.other": "Other",

  // Material categories (MATERIAL_CATEGORIES)
  "enumsKnowledge.category.material.certificates": "Certificates",
  "enumsKnowledge.category.material.workSamples": "Work samples",
  "enumsKnowledge.category.material.links": "Links",
  "enumsKnowledge.category.material.notes": "Notes",
  "enumsKnowledge.category.material.internshipDocuments": "Internship documents",
  "enumsKnowledge.category.material.campusDocuments": "Campus documents",
  "enumsKnowledge.category.material.other": "Other",
} as const;

export default enumsKnowledge;
