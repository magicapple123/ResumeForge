// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「自动备份状态」卡（`BackupStatusCard`）：保护状态标签与其说明、备份间隔选择、
 * 最近一次成功时间与自动快照清单。
 *
 * ## 状态按后端 `state` 枚举分组
 *
 * 每组一条 `label`（标签）加一条 `hint`（只有读不了目录 / 快照缺失 / 已禁用三种状态
 * 有额外说明）。`statusMeta()` 只返回 `labelKey`，渲染处才 `t()`——在模块作用域求值
 * 会把语言钉死。
 *
 * ## 「每 [下拉] 天…」拆成前缀 + 整句
 *
 * 间隔选择器必须夹在「每」和后面的整句之间，所以前缀只有「每」一个词；下拉之后的
 * 整句（含「只保留最近几份」）合成一条 key，英文里语序才通。下拉选项自己的
 * 「{count} 天」是独立的一条，与句子无关。
 */
const backupStatus = {
  /** 卡片标题。 */
  "backupStatus.title": "自动备份状态",
  /** 右上角刷新按钮的无障碍名。 */
  "backupStatus.refresh.aria": "刷新备份状态",

  /** 部署配置禁用自动备份时的标签（此时不能显示「受保护/保护中断」）。 */
  "backupStatus.state.disabled.label": "自动备份已禁用",
  /** 禁用态说明：告诉用户还能手动导出，不留死路。 */
  "backupStatus.state.disabled.hint": "自动备份已禁用（由部署配置控制）；仍可手动导出备份包。",
  /** 快照目录读不了：只能说「无法确认」，不能当成「没有」。 */
  "backupStatus.state.unreadable.label": "无法确认",
  /** 读不了目录时的说明：先说清原因，再说清"当前判断不了"。 */
  "backupStatus.state.unreadable.hint":
    "无法读取快照目录，请检查磁盘权限；当前无法确认快照是否存在。",
  /** 连续失败：保护有缺口。 */
  "backupStatus.state.failing.label": "保护中断",
  /** 从未成功备份过。 */
  "backupStatus.state.never.label": "尚无备份",
  /** 有成功记录但磁盘上找不到快照文件。 */
  "backupStatus.state.empty.label": "快照缺失",
  /** 快照缺失时的说明：历史成功记录还在，但文件不在了。 */
  "backupStatus.state.empty.hint": "上次成功记录存在，但当前找不到快照文件；请重新备份一次。",
  /** 超过间隔没有成功备份。 */
  "backupStatus.state.overdue.label": "已到期未备份",
  /** 一切正常。 */
  "backupStatus.state.protected.label": "受保护",

  /** 间隔下拉的无障碍名（保留原文的「（天）」，与既有测试一致）。 */
  "backupStatus.interval.aria": "自动备份间隔（天）",
  /** 下拉选项：`{count}` 是天数。 */
  "backupStatus.interval.optionDays": "{count} 天",
  /** 间隔那句话的前半截，选择器之后接 `interval.suffix`。 */
  "backupStatus.interval.prefix": "每",
  /** 间隔那句话的后半截（含保留策略），接在选择器后面。 */
  "backupStatus.interval.suffix":
    "天自动快照一次（仅数据库快照，不含附件文件）；手动导出的备份包才包含附件。只保留最近几份，手动备份不受影响。",
  /** 禁用态下的后半截：档位由部署配置控制，手动导出仍含附件。 */
  "backupStatus.interval.suffixDisabled":
    "天自动快照次数由部署配置控制；手动导出的备份包仍包含附件。只保留最近几份，手动备份不受影响。",
  /** 修改间隔成功的 Toast；`{count}` 是新天数。 */
  "backupStatus.interval.saved": "自动备份间隔已改为每 {count} 天，下次调度检查时生效",
  /** 保存间隔失败的兜底文案（后端给了 message 就用后端的）。 */
  "backupStatus.interval.saveFailed": "保存自动备份间隔失败",

  /** 最近一次成功备份的时间；`{time}` 是格式化后的时间。 */
  "backupStatus.lastSuccess": "最近一次成功备份：{time}",
  /** 从未成功过时的提示。 */
  "backupStatus.lastSuccess.never": "还没有成功过的自动备份。",
  /** 覆盖范围说明：只含数据库快照，要连附件一起备份得去「数据集」卡片手动导出。 */
  "backupStatus.coverage.databaseOnly":
    "自动备份只覆盖数据库快照，不含附件与字体；需要连附件与字体一起备份，请用「数据集」卡片的「导出数据集 / 导出全部数据集」。",
  /** 连续失败提示：`{count}` 次数、`{error}` 后端给的原因。 */
  "backupStatus.failures": "连续 {count} 次备份失败：{error}。系统会按短间隔自动重试。",
  /** 一份自动快照都没有时的空态。 */
  "backupStatus.snapshots.empty": "暂无自动快照；首次成功备份后会在这里列出。",
} as const;

export default backupStatus;
