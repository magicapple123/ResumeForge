// SPDX-License-Identifier: Apache-2.0
/**
 * 求职进度域的四张「协议值 → 语言包 key」映射。
 *
 * 协议值（`applied` / `referral` / `created` …）与后端 `models/tracker.py` 逐字对应，
 * 永远不翻；显示名在 `i18n/messages/*.enumsTracker.ts`。模块作用域不求值 `t()`——
 * 那样切语言不会重渲染——使用处再翻译。
 *
 * `offer` 的显示名指向 `trackerForm.status.offer`：它的原中文就是英文词 `Offer`，
 * 复制进新包会触发 `messageContract` 的 `source-ascii-english`（该词条已在
 * `guards/equalityExemptions.ts` 登记，本批不改守卫数据），复用它不改变任何渲染结果。
 */
import type { MessageKey } from "../../i18n";
import type { MergeAction, TrackChannel, TrackSource, TrackStatus } from "../../types";

/** 漏斗的七个状态，顺序与协议值一致。 */
export const TRACK_STATUS_LABEL_KEYS: Record<TrackStatus, MessageKey> = {
  applied: "enumsTracker.status.applied",
  screening: "enumsTracker.status.screening",
  assessment: "enumsTracker.status.assessment",
  interview: "enumsTracker.status.interview",
  offer: "trackerForm.status.offer",
  rejected: "enumsTracker.status.rejected",
  unknown: "enumsTracker.status.unknown",
};

/** 记录来源：投递台自动记的、自己加的、识别导入的。 */
export const TRACK_SOURCE_LABEL_KEYS: Record<TrackSource, MessageKey> = {
  apply: "enumsTracker.source.apply",
  manual: "enumsTracker.source.manual",
  recognized: "enumsTracker.source.recognized",
};

/** 投递渠道：这份工作是从哪来的。 */
export const TRACK_CHANNEL_LABEL_KEYS: Record<TrackChannel, MessageKey> = {
  unknown: "enumsTracker.channel.unknown",
  referral: "enumsTracker.channel.referral",
  official_website: "enumsTracker.channel.official_website",
  job_platform: "enumsTracker.channel.job_platform",
  headhunter: "enumsTracker.channel.headhunter",
  other: "enumsTracker.channel.other",
};

/** 合并结论：这次识别对记录做了什么。 */
export const MERGE_ACTION_LABEL_KEYS: Record<MergeAction, MessageKey> = {
  created: "enumsTracker.mergeAction.created",
  updated: "enumsTracker.mergeAction.updated",
  unchanged: "enumsTracker.mergeAction.unchanged",
};
