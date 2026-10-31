// SPDX-License-Identifier: Apache-2.0
/**
 * 「从资料箱选入」的**纯映射规则**（从 MaterialPickView 拆出）。
 *
 * 组件文件只导出组件（React Fast Refresh 要求）；映射与分类默认值放在这里可单测。
 * 分类是后端 MATERIAL_CATEGORIES 的中文字面值（数据键，不是界面文案）。
 */
import { splitLines } from "./factModel";
import type { FactKind, FactPayload } from "./types";
import type { MaterialSummary } from "../../types";

// 资料箱分类是后端 MATERIAL_CATEGORIES 的中文字面值（数据键，不是界面文案）。
const CATEGORY_TO_KIND: Record<string, FactKind> = {
  证书: "credential", // i18n-ok: 后端资料箱分类原文
  作品: "work_project", // i18n-ok: 后端资料箱分类原文
  链接: "work_project", // i18n-ok: 后端资料箱分类原文
  实习材料: "practice", // i18n-ok: 后端资料箱分类原文
  校园材料: "practice", // i18n-ok: 后端资料箱分类原文
  笔记: "practice", // i18n-ok: 后端资料箱分类原文
};

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

/** 把一条资料映射成某类事实的**草稿**；不确定的字段一律留空。 */
export function materialToDraft(material: MaterialSummary, kind: FactKind): FactPayload {
  const lines = splitLines(material.content);
  const url = isHttpUrl(material.url) ? material.url : "";
  const note = material.content || "";
  const custom_fields: FactPayload["custom_fields"] = [];
  switch (kind) {
    case "publication":
      return {
        title: material.title,
        authors: [{ name: "", is_self: true, corresponding: false }],
        venue: "",
        year: "",
        status: "other",
        doi: "",
        url,
        volume_pages: "",
        note,
        custom_fields,
      };
    case "research_project":
      return {
        name: material.title,
        role: "",
        organization: "",
        start_date: "",
        end_date: "",
        funding: "",
        description: lines,
        outcomes: [],
        custom_fields,
      };
    case "patent":
      return {
        title: material.title,
        inventors: [{ name: "", is_self: true, corresponding: false }],
        patent_number: "",
        country: "",
        status: "other",
        filed_date: "",
        granted_date: "",
        url,
        custom_fields,
      };
    case "credential":
      return {
        name: material.title,
        issuer: "",
        issue_date: "",
        expiry_date: "",
        status: "unknown",
        credential_number: "",
        verify_url: url,
        note,
        custom_fields,
      };
    case "work_project":
      return {
        name: material.title,
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: lines,
        highlights: [],
        public_url: url,
        artifact_type: "",
        custom_fields,
      };
    case "practice":
      return {
        organization: material.title,
        role: "",
        experience_kind: "other",
        start_date: "",
        end_date: "",
        description: lines,
        custom_fields,
      };
    case "award":
      return {
        name: material.title,
        issuer: "",
        date: "",
        level: "",
        description: note,
        custom_fields,
      };
    case "training":
      return {
        name: material.title,
        organization: "",
        start_date: "",
        end_date: "",
        hours: "",
        description: lines,
        outcomes: [],
        custom_fields,
      };
    case "language":
      return {
        name: material.title,
        level: "",
        certificate: "",
        score: "",
        date: "",
        custom_fields,
      };
  }
}

/** 分类→默认类型（未知分类落到实践/服务，最中性、不含资格暗示）。 */
export function defaultKindForCategory(category: string): FactKind {
  return CATEGORY_TO_KIND[category] ?? "practice";
}
