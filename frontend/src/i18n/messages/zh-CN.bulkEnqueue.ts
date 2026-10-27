// SPDX-License-Identifier: Apache-2.0
/**
 * 批量「直接加入投递队列」的聚合账目（`components/apply/queue/bulkEnqueue.ts`）。
 *
 * ## 这里只有一句给用户看的话
 *
 * `bulkEnqueueSummary(outcome)` 把逐条入队的结果拼成**一句话**（成功 Toast 的正文，
 * 也会被「本次采集结果」面板当 `{summary}` 参数接收）。所以下面四条是**分句**，不是
 * 可自由拼接的词块：每一条都能独立成句，`separator` 只负责把分句连起来。
 *
 * ## 分隔符为什么也进语言包
 *
 * 中文用全角逗号、英文用半角逗号加空格。把它留在代码里（`parts.join("，")`）等于在
 * 代码里写死一种语言的标点，英文界面就会出现「,」与「，」混排。所以它是一条 key，
 * 不是常量。
 *
 * ## 不在这里的东西
 *
 * `isAlreadyQueued()` 里的「已在投递队列中」是**后端返回的错误文案**，用来做匹配，
 * 属于协议耦合，不能翻也不能搬进语言包——那条字符串留在源码里并带 `i18n-ok:` 说明。
 */
const bulkEnqueue = {
  /** 第一分句：成功入队的条数。总是出现（0 也照样说，用户要知道"一条都没进"）。 */
  "bulkEnqueue.summary.enqueued": "已加入投递队列 {count} 个",
  /** 第二分句：本来就在队列里、被跳过的条数（为 0 时不出现）。 */
  "bulkEnqueue.summary.alreadyQueued": "{count} 个已在队列",
  /** 第三分句：来源不支持自动投递的条数（为 0 时不出现）。 */
  "bulkEnqueue.summary.unsupported": "{count} 个来源不支持自动投递",
  /** 第四分句：其它失败的条数（为 0 时不出现；明细由调用方按需展开）。 */
  "bulkEnqueue.summary.failed": "{count} 个失败",
  /** 分句之间的分隔符（见文件头：标点也是文案）。 */
  "bulkEnqueue.summary.separator": "，",

  /** 单条入队抛出的不是 Error 时的兜底原因（`err.message` 才是后端原文，那是透传）。 */
  "bulkEnqueue.error.enqueueFailed": "加入投递队列失败",
} as const;

export default bulkEnqueue;
