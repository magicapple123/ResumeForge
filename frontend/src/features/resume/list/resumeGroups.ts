// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心「按岗位折叠」的唯一实现（CR-33）。
 *
 * 口径（任务书 CR-33）：
 * - 同一**非空** ``job_id`` 的多份简历收成一组，行上显示「岗位 · N 个版本」；
 * - 无 ``job_id`` 的通用简历各自成组（它们不是同一岗位的版本，合并会误导）；
 * - 组内按更新时间倒序（缺失 ``updated_at`` 的旧行回落到创建时间）；
 * - 组顺序**跟随服务端排序的首次出现顺序**，不在这里重排——否则列头排序会失效；
 * - 投递次数是后端按 ``job_id`` 聚合的只读值，组内各版本相同，取最大值。
 *
 * 纯函数：不读 localStorage、不发请求，页面只负责渲染与分页切片。
 */
import type { ResumeBrief } from "../../../types";

export interface ResumeGroup {
  /** 行 key：有岗位用 `job:<id>`，通用简历用 `resume:<id>`（两者不会撞）。 */
  key: string;
  jobId: number | null;
  jobTitle: string;
  company: string;
  /** 组内版本，按更新时间倒序；数组第一项即 `latest`。 */
  versions: ResumeBrief[];
  latest: ResumeBrief;
  latestUpdatedAt: string | null;
  versionCount: number;
  /** 所属岗位被投递的次数（后端 `delivery_count`，通用简历为本人被投递次数）。 */
  deliveryCount: number;
  /** 任一版本收藏过：组行只读展示星标，不提供组级收藏动作。 */
  hasFavorite: boolean;
}

function timestampOf(item: ResumeBrief): number {
  const raw = item.updated_at ?? item.created_at;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareVersionsDesc(left: ResumeBrief, right: ResumeBrief): number {
  const diff = timestampOf(right) - timestampOf(left);
  // 时间相同按 id 倒序：分页/重取后顺序稳定，测试不依赖数据库返回顺序。
  return diff !== 0 ? diff : right.id - left.id;
}

/** 一份简历所属的组 key（页面与版本列表共用，避免两处各拼一次）。 */
export function groupKeyOf(item: ResumeBrief): string {
  return item.job_id ? `job:${item.job_id}` : `resume:${item.id}`;
}

/**
 * 这个组里的全部 `resume_id`（组内版本倒序，最新在前）。
 *
 * 折叠表的**组行勾选 = 整组全部版本**（2026-11-26 三态方案，推翻 CR-33 的
 * "多版本组不可勾选"）：勾选框要有确定的语义，而"这一行的勾选框代表哪一份简历"
 * 说不清，所以它代表整组。批量栏因此按「份」计数，并注明其中几个是整组带上来的
 * （见 `ResumeGroupedTable` 的选区摘要）。
 *
 * 只此一处做 key → id 的展开：`rowSelection` 的 `onSelect` / `onSelectAll` 与
 * `selectedRowKeys` 的反推都读它，各写一遍迟早有一处漏掉某个版本。
 */
export function groupResumeIds(group: ResumeGroup): number[] {
  return group.versions.map((version) => version.id);
}

export function groupResumes(items: ResumeBrief[]): ResumeGroup[] {
  const buckets = new Map<string, ResumeGroup>();
  for (const item of items) {
    const key = groupKeyOf(item);
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        key,
        jobId: item.job_id,
        jobTitle: item.job_title,
        company: item.company,
        versions: [item],
        latest: item,
        latestUpdatedAt: item.updated_at ?? item.created_at ?? null,
        versionCount: 1,
        deliveryCount: item.delivery_count ?? 0,
        hasFavorite: item.favorite,
      });
      continue;
    }
    existing.versions.push(item);
    existing.deliveryCount = Math.max(existing.deliveryCount, item.delivery_count ?? 0);
    existing.hasFavorite = existing.hasFavorite || item.favorite;
  }

  return [...buckets.values()].map((group) => {
    const versions = [...group.versions].sort(compareVersionsDesc);
    const latest = versions[0];
    return {
      ...group,
      versions,
      latest,
      // 岗位名/公司以最新一版为准：用户前几版可能忘了填公司，最新那版修好了。
      jobTitle: latest.job_title || group.jobTitle,
      company: latest.company || group.company,
      latestUpdatedAt: latest.updated_at ?? latest.created_at ?? null,
      versionCount: versions.length,
    };
  });
}
