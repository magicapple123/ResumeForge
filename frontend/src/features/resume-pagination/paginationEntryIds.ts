// SPDX-License-Identifier: Apache-2.0
/**
 * 收集简历正文里**仍然存在的条目 id**（分页意图 prune 的"活对象清单"）。
 *
 * 只管"哪些 id 还活着"，**不管名字**：芯片文案由 `paginationEntryLabels.ts` 按
 * `ENTRY_POINT_FIELDS`（含 skills）给出。两者口径故意不同——这里偏宽（多留一条无害的意图
 * 好过误删用户的设置），那里必须覆盖全部分区（漏一个就会把还在的条目显示成「已删除的条目」）。
 *
 * ## 为什么需要 id 清单
 *
 * `format_config.pagination.entries` 以稳定对象 id 为键。用户删掉一条实习、或整块经历被
 * 结构命令清空之后，域里那条意图不会自己消失——导出端按 id 找不到对象就静默忽略，界面上
 * 却会留一个谁也解释不了的芯片。于是每次改写分页意图前先拿本文的清单裁一次
 * （见 `paginationDomain.pruneStalePagination`）。
 *
 * ## 判定：任何「对象数组」里的 `id` 都算活对象
 *
 * 正文的条目容器有两种形状，而且以后可能更多：
 *
 * - 顶层板块数组：`content.experience = [{ id, company, … }]`（今天的主形状）；
 * - 条目内部的子数组：`content.education[0].entries = [{ id, … }]`。
 *
 * 硬编码板块名会在加板块的那天悄悄漏掉一整类对象，所以这里只做结构判断：**数组里的每个
 * 对象元素，只要有合法 `id` 就收下**，并继续往里递归（子数组、嵌套 `entries` 都会覆盖）。
 *
 * 这样刻意偏**宽松**：多收一个 id 顶多多留一条无害的意图；少收一个会把用户的设置
 * 悄悄删掉（不可撤销）。两个方向的代价不对称，所以宁可宽。
 *
 * ## id 形状
 *
 * 与 `paginationDomain.ts` 的 `OBJECT_ID` **逐字相同**（`/^[A-Za-z0-9_-]{8,32}$/`）：
 * 一个模块负责"写得进去"，一个负责"留得下来"，判定必须一致，否则会出现"界面能写、
 * 保存即被裁掉"这种谁也说不清的行为。刻意复制这条正则而不 import：它属于两个模块共同
 * 遵守的数据契约常量，不是实现细节。
 *
 * 深度上限 8：正文是浅结构（最深的已知形状是 顶层数组 → 条目 → entries → 条目），
 * 上限只用来防环引用/畸形数据把调用方拖死，不参与业务判断。
 */
import type { ResumeContent } from "../../types";

/** 与 `paginationDomain.ts` 的 `OBJECT_ID` 逐字相等（见文件头说明）。 */
const OBJECT_ID = /^[A-Za-z0-9_-]{8,32}$/;

/** 递归深度上限（防御环引用/畸形数据，不参与业务判断）。 */
const MAX_DEPTH = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectFromValue(value: unknown, depth: number, found: Set<string>): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isRecord(item)) {
        const id = item["id"];
        if (typeof id === "string" && OBJECT_ID.test(id)) found.add(id);
      }
      collectFromValue(item, depth + 1, found);
    }
    return;
  }
  if (!isRecord(value)) return;
  for (const child of Object.values(value)) collectFromValue(child, depth + 1, found);
}

/**
 * 正文里所有仍然存在的条目 id（去重、保持首次出现顺序）。
 *
 * `content` 为 `null`/非对象时返回空数组——调用方据此判断"没有可核对的清单"，
 * 不要把它当成"所有意图都过期"（那会把用户的设置一次清空）。
 */
export function collectPaginationEntryIds(content: ResumeContent | null | undefined): string[] {
  const found = new Set<string>();
  if (!isRecord(content)) return [];
  collectFromValue(content, 0, found);
  return Array.from(found);
}
