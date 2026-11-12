// SPDX-License-Identifier: Apache-2.0
/**
 * 投递台 #14 的补充接口类型（体检 / 漏斗 / 跟进 / 话术库 / 屏蔽清单）。
 *
 * 这里的字符串字面量联合类型是**协议值**，与后端返回的 `code` / `severity` /
 * `stage` 逐字一致，改一处必须同步另一处。展示名一律在前端语言包里按协议值映射
 * （`applyQueue.preflight.code.*`），不要把这些中文写进类型层。
 */

// ===== 14A 投递前体检 =====

/** 体检严重度：`blocking` 会被后端拦下，`warning` 只是白投风险。 */
export type ApplyPreflightSeverity = "blocking" | "warning";

/**
 * 体检规则码（后端 `services/apply/preflight.py` 的规则码逐字镜像）。
 *
 * `ghost_job` 是 #15A 加的那一条：它读**采集历史**（`job_seen`）而不是岗位正文，
 * 结论是"这条岗位可能长期挂着不招"。后端 `PreflightCode` 是 Literal，漏了这一项
 * 出口校验就会失败；前端这边漏了，`CODE_LABEL_KEYS[code]` 会取到 `undefined` 直接崩。
 */
export type ApplyPreflightCode =
  | "source_unsupported"
  | "resume_missing"
  | "match_missing"
  | "match_weak"
  | "greeting_weak"
  | "ghost_job";

/**
 * 一条体检结论。
 *
 * `message` 是"这一条现在投出去会怎样"，`fix` 是后端给的修法说明——两者都是后端文案，
 * 原样展示（前端不重写一遍，避免两处措辞分叉）。
 */
export interface ApplyPreflightIssue {
  code: ApplyPreflightCode;
  severity: ApplyPreflightSeverity;
  message: string;
  fix: string;
}

/** 单个队列条目的体检结果；`queue_id` 是队列条目 id（不是岗位 id）。 */
export interface ApplyPreflightItem {
  queue_id: number;
  issues: ApplyPreflightIssue[];
}

export interface ApplyPreflightResult {
  items: ApplyPreflightItem[];
  summary: {
    blocking: number;
    warnings: number;
  };
}

// ===== 14F 漏斗条 =====

/** 最近 N 天的执行量（与 analytics 的长期转化率是两个口径，不互相覆盖）。 */
export interface ApplyFunnelSummary {
  applied: number;
  succeeded: number;
  failed: number;
  interviewing: number;
}

// ===== 14C 跟进闭环 =====

/** 一条 7 天以上没有回音的投递记录（`days` 是后端算好的天数）。 */
export interface ApplyStaleRecord {
  record_id: number;
  job_id: number | null;
  job_title: string;
  company: string;
  applied_at: string;
  days: number;
}

export interface ApplyStaleList {
  items: ApplyStaleRecord[];
  count: number;
}

/** 「更新进度」的响应：`created=false` 表示复用了一条已有的求职进度记录。 */
export interface ApplyTrackResult {
  track_id: number;
  created: boolean;
  stage: string;
}

// ===== 14D 话术库 =====

/**
 * 一条招呼语模板。
 *
 * `body` 支持 `{company}` / `{job_title}` / `{name}` 三个变量，渲染时缺值回落空串
 * （渲染逻辑在 `features/apply/queue/greetingTemplate.ts`，纯函数）。
 * `uses` 是使用次数（首版只累计次数，不做面试率）。
 */
export interface GreetingTemplate {
  id: string | number;
  name: string;
  body: string;
  tags: string[];
  uses: number;
}

export interface GreetingTemplateList {
  templates: GreetingTemplate[];
}

// ===== 14E 屏蔽清单 =====

/** 屏蔽清单：公司按公司名比较，关键词按包含匹配（后端要求 ≥2 字且非通用词）。 */
export interface ApplyBlocklist {
  companies: string[];
  keywords: string[];
}
