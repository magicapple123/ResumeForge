// SPDX-License-Identifier: Apache-2.0
/**
 * 「任务完成后跳哪」的唯一映射表：**纯函数**，不做副作用、不碰路由。
 *
 * 为什么单独一个文件：同一个地址散在 6 处硬编码（通知卡片、页头任务条、列表里点标题、
 * 全局搜索…）时，改一次路由规则就要全库搜字符串；更糟的是"通知点进去不是那条记录"这类
 * 错只能靠人肉对比字符串发现。所以"任务类型 + 结果标识 → 路由"收成一处，调用方只拿到
 * 一个可以直接交给 `navigate()` 的字符串（或 `null`）。
 *
 * 约定（与既有深链保持一致，不要另立新参数名）：
 * - 简历 → `/resumes?resume_id=<id>`
 * - 岗位 → `/jobs?job_id=<id>`
 * - 批量适配记录 → `/jobs?match_batch=history`
 *
 * `null` 的含义是"**别跳**"：任务类型能识别但结果标识缺失（例如简历生成失败、还没拿到
 * id）时，跳到一个空态页比不跳更让人困惑，调用方据此少渲染那颗按钮即可。
 */

/** 能映射成前端路由的任务类型（= 任务的 `ref_kind`）。 */
export type TaskDeepLinkKind =
  "resume" | "job" | "job_match_batch" | "assistant" | "interview" | "webform" | "drill" | "claim";

/** 结果标识：后端 id 可能是数字，也可能从 query / localStorage 回来的是字符串。 */
export type TaskDeepLinkRef = number | string | null | undefined;

/**
 * 把任意 id 收敛成正整数形式的字符串。
 *
 * 为什么连字符串也要校验：这些 id 最终会被拼进地址栏，`"12&analysis=1"` 这种值拼进去
 * 就成了两个参数（等于允许上游往路由里注入参数）。只认纯数字，其余一律 `null`。
 */
function positiveId(ref: TaskDeepLinkRef): string | null {
  if (ref === null || ref === undefined) return null;
  if (typeof ref === "number") {
    return Number.isInteger(ref) && ref > 0 ? String(ref) : null;
  }
  const text = ref.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value > 0 ? String(value) : null;
}

/** 简历中心并定位到一条简历。`id` 缺失时返回 `null`（调用方据此不跳）。 */
export function resumeDeepLink(resumeId: TaskDeepLinkRef): string | null {
  const id = positiveId(resumeId);
  return id === null ? null : `/resumes?resume_id=${id}`;
}

/** 岗位广场并定位到一个岗位。`id` 缺失时返回 `null`。 */
export function jobDeepLink(jobId: TaskDeepLinkRef): string | null {
  const id = positiveId(jobId);
  return id === null ? null : `/jobs?job_id=${id}`;
}

/**
 * 岗位广场并**自动打开**「岗位解读」弹窗（`/jobs?job_id=<id>&analysis=1`）。
 *
 * 岗位解读的完成通知必须落到"能直接看到那份解读"的地方：只给 `job_id` 会让用户停在
 * 岗位列表上、还得自己再点一次「AI 解读」。`analysis=1` 是既有参数（`JobsPage` 已经在
 * 消费它并在详情拉全后自动开窗），这里只是把它收进唯一映射表，不在调用方手拼。
 */
export function jobAnalysisDeepLink(jobId: TaskDeepLinkRef): string | null {
  const id = positiveId(jobId);
  return id === null ? null : `/jobs?job_id=${id}&analysis=1`;
}

/**
 * 岗位广场的分析记录视图（批量适配的落点）。
 *
 * **没有 id 参数**：批量适配的结果是一批记录，落点是"分析记录"这个视图本身；而且页头
 * 任务条与完成通知都指向它，加 id 反而会让"记录已被清理"变成一片空白。所以这里恒定
 * 返回地址，不需要 null 分支。
 */
export function jobMatchHistoryDeepLink(): string {
  return "/jobs?match_batch=history";
}

/**
 * 任务类型 + 结果标识 → 前端路由。
 *
 * 未知类型返回 `null`：调用方拿不到地址就不渲染跳转入口，比猜一个默认页安全。
 */
export function taskDeepLink(kind: TaskDeepLinkKind, refId?: TaskDeepLinkRef): string | null {
  switch (kind) {
    case "resume":
      return resumeDeepLink(refId);
    case "job":
      return jobDeepLink(refId);
    case "job_match_batch":
      return jobMatchHistoryDeepLink();
    // 下面几个是"整页型"结果：页面本身就是落点，没有可定位的记录 id。
    case "assistant":
      return "/assistant";
    case "interview":
      return "/interview";
    case "webform":
      return "/webform";
    case "drill":
      return "/claims/drill";
    case "claim":
      return "/claims";
    default:
      return null;
  }
}
