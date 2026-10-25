// SPDX-License-Identifier: Apache-2.0
/**
 * 科研三栏的**字段数据层**（W14）：空条目工厂、状态枚举与标签 key、防御性归一化、排序帮助。
 *
 * ## 为什么空条目要在这里定义
 *
 * 「添加一条」写进表单的值必须与后端 schema 的默认值一致（空串 / 空数组 / `status: "other"`），
 * 否则后端 Pydantic 会用默认值补齐、前端却以为自己写了别的东西。空值只在这里定义一次，
 * 组件与测试都从这里取——两处各写一份，字段一改就会分叉。
 *
 * ## 归一化为什么是"防御性"的
 *
 * 旧记录没有这三个键（`[]` 之外还可能被外部工具改坏），后端 GET 是宽容的，前端读取也必须宽容：
 * 缺字段补默认、`status` 非法值落到 `other`、作者列表里的脏元素直接丢弃。**不猜、不迁移**。
 */
import type {
  ResumeAuthor,
  ResumePatent,
  ResumePatentStatus,
  ResumePublication,
  ResumePublicationStatus,
  ResumeResearchProject,
} from "./types";
import type { ResearchMessageKey } from "./i18n";

/** 论文的发表状态顺序 = 下拉顺序（published 在前：最常见的先选）。 */
export const PUBLICATION_STATUSES: readonly ResumePublicationStatus[] = [
  "published",
  "accepted",
  "in_press",
  "under_review",
  "preprint",
  "other",
];

/** 专利状态顺序（granted 在前：已完成的最常见）。 */
export const PATENT_STATUSES: readonly ResumePatentStatus[] = [
  "granted",
  "pending",
  "filed",
  "expired",
  "other",
];

/** 状态值 → 文案 key。未知值由归一化先收口到 other，这里不处理。 */
const PUBLICATION_STATUS_KEYS: Record<ResumePublicationStatus, ResearchMessageKey> = {
  published: "research.status.published",
  accepted: "research.status.accepted",
  in_press: "research.status.in_press",
  under_review: "research.status.under_review",
  preprint: "research.status.preprint",
  other: "research.status.other",
};

const PATENT_STATUS_KEYS: Record<ResumePatentStatus, ResearchMessageKey> = {
  granted: "research.patentStatus.granted",
  pending: "research.patentStatus.pending",
  filed: "research.patentStatus.filed",
  expired: "research.patentStatus.expired",
  other: "research.patentStatus.other",
};

/** 论文状态 → 文案 key。 */
export function publicationStatusKey(status: ResumePublicationStatus): ResearchMessageKey {
  return PUBLICATION_STATUS_KEYS[status] ?? PUBLICATION_STATUS_KEYS.other;
}

/** 专利状态 → 文案 key。 */
export function patentStatusKey(status: ResumePatentStatus): ResearchMessageKey {
  return PATENT_STATUS_KEYS[status] ?? PATENT_STATUS_KEYS.other;
}

/** 一条空作者/发明人。 */
export function emptyAuthor(): ResumeAuthor {
  return { name: "", is_self: false, corresponding: false };
}

/** 一条空论文（字段与后端默认值一致；作者列表先空，用户点「添加作者」）。 */
export function emptyPublication(): ResumePublication {
  return {
    title: "",
    authors: [],
    venue: "",
    year: "",
    status: "other",
    doi: "",
    url: "",
    volume_pages: "",
    note: "",
    outcome_type: "",
    my_rank: "",
  };
}

/** 一条空科研项目。 */
export function emptyResearchProject(): ResumeResearchProject {
  return {
    name: "",
    role: "",
    organization: "",
    start_date: "",
    end_date: "",
    funding: "",
    level: "",
    description: [],
    outcomes: [],
  };
}

/** 一条空专利。 */
export function emptyPatent(): ResumePatent {
  return {
    title: "",
    inventors: [],
    patent_number: "",
    country: "",
    status: "other",
    filed_date: "",
    granted_date: "",
    url: "",
  };
}

/** 数组内移动一条（上移/下移共用的纯函数）；越界返回原数组的副本。 */
export function moveListItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = items.slice();
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asTextList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** 作者数组归一化：丢弃非对象元素，布尔字段缺省 false。 */
export function normalizeAuthors(value: unknown): ResumeAuthor[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (item === null || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    return [
      {
        name: asText(record.name),
        is_self: record.is_self === true,
        corresponding: record.corresponding === true,
      },
    ];
  });
}

/** 论文归一化：缺字段补默认，未知状态落 other。 */
export function normalizePublication(value: unknown): ResumePublication {
  const record = (value ?? {}) as Record<string, unknown>;
  const status = PUBLICATION_STATUSES.find((item) => item === record.status) ?? "other";
  return {
    title: asText(record.title),
    authors: normalizeAuthors(record.authors),
    venue: asText(record.venue),
    year: asText(record.year),
    status,
    doi: asText(record.doi),
    url: asText(record.url),
    volume_pages: asText(record.volume_pages),
    note: asText(record.note),
  };
}

/** 科研项目归一化。 */
export function normalizeResearchProject(value: unknown): ResumeResearchProject {
  const record = (value ?? {}) as Record<string, unknown>;
  return {
    name: asText(record.name),
    role: asText(record.role),
    organization: asText(record.organization),
    start_date: asText(record.start_date),
    end_date: asText(record.end_date),
    funding: asText(record.funding),
    description: asTextList(record.description),
    outcomes: asTextList(record.outcomes),
  };
}

/** 专利归一化。 */
export function normalizePatent(value: unknown): ResumePatent {
  const record = (value ?? {}) as Record<string, unknown>;
  const status = PATENT_STATUSES.find((item) => item === record.status) ?? "other";
  return {
    title: asText(record.title),
    inventors: normalizeAuthors(record.inventors),
    patent_number: asText(record.patent_number),
    country: asText(record.country),
    status,
    filed_date: asText(record.filed_date),
    granted_date: asText(record.granted_date),
    url: asText(record.url),
  };
}

/** 三类栏目里有没有任何内容（决定页签是否给个圆点/是否展示空态）。 */
export function hasResearchContent(
  slice:
    | {
        publications?: readonly unknown[];
        research_projects?: readonly unknown[];
        patents?: readonly unknown[];
      }
    | null
    | undefined,
): boolean {
  if (!slice) return false;
  return (
    (slice.publications?.length ?? 0) > 0 ||
    (slice.research_projects?.length ?? 0) > 0 ||
    (slice.patents?.length ?? 0) > 0
  );
}
