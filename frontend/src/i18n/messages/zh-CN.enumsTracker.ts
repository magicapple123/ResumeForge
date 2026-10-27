// SPDX-License-Identifier: Apache-2.0
/**
 * 求职进度域的四张枚举词表：进度状态、记录来源、投递渠道与识别合并结论。
 *
 * 键是协议值（与后端 `models/tracker.py` 逐字对应，见 `types/tracker.ts`），值是显示名；
 * 页面层通过 `i18n/enum/tracker.ts` 的映射表取 key。中文值逐字等于 `types/tracker.ts`
 * 的 `TRACK_STATUS_LABELS` / `TRACK_SOURCE_LABELS` / `TRACK_CHANNEL_LABELS` /
 * `MERGE_ACTION_LABELS`，迁移前后中文渲染结果不变；`types/tracker.ts` 一个字都没动。
 *
 * `offer` 不在这里：它的原中文就是英文词 `Offer`，显示名沿用 `trackerForm.status.offer`
 * （已登记为语言无关词），不再复制一条同义 key。
 */
const enumsTracker = {
  "enumsTracker.status.applied": "已投递",
  "enumsTracker.status.screening": "筛选中",
  "enumsTracker.status.assessment": "测评/笔试",
  "enumsTracker.status.interview": "面试",
  "enumsTracker.status.rejected": "已结束",
  "enumsTracker.status.unknown": "待确认",

  "enumsTracker.source.apply": "投递台自动记录",
  "enumsTracker.source.manual": "手动添加",
  "enumsTracker.source.recognized": "识别导入",

  "enumsTracker.channel.unknown": "未知",
  "enumsTracker.channel.referral": "内推",
  "enumsTracker.channel.official_website": "官网",
  "enumsTracker.channel.job_platform": "招聘平台",
  "enumsTracker.channel.headhunter": "猎头/中介",
  "enumsTracker.channel.other": "其他",

  "enumsTracker.mergeAction.created": "新增记录",
  "enumsTracker.mergeAction.updated": "更新进度",
  "enumsTracker.mergeAction.unchanged": "已是最新，未改动",
} as const;

export default enumsTracker;
