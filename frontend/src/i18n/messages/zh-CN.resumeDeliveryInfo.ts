// SPDX-License-Identifier: Apache-2.0
/**
 * 版本信息位（RF-17 / PR-09 可信交付账本）：简历的版本血缘与投递记录标签。
 *
 * 覆盖三类语义区分：投递来源的显示名、每条记录的「前缀 + 目的地 + 后缀」，
 * 以及目的地缺失、加载失败、存档下载这些提示与兜底文案。
 * 「重试」是通用动作，复用 `common.retry`，不在本包重复。
 */
const resumeDeliveryInfo = {
  // ── 投递来源的显示名（对象键仍是后端 source 协议值）────────────────────
  /** 投递台：真实的投递动作回写。 */
  "resumeDeliveryInfo.source.apply": "投递台",
  /** 进度关联：用户手工把进度关联到这份简历。 */
  "resumeDeliveryInfo.source.track": "进度关联",
  /** 导出存档：导出时显式落档。 */
  "resumeDeliveryInfo.source.export": "导出存档",

  // ── 每条记录的前缀：只有 apply 代表"已实际投递" ────────────────────────
  "resumeDeliveryInfo.prefix.apply": "已投递给",
  "resumeDeliveryInfo.prefix.track": "进度关联：",
  "resumeDeliveryInfo.prefix.export": "导出存档：",
  /** 未知来源的兜底前缀。 */
  "resumeDeliveryInfo.prefix.default": "交付记录：",

  // ── 后缀说明：明确"这不是投递台发送"的两种情况 ─────────────────────────
  "resumeDeliveryInfo.suffix.track": "（手工关联，非投递台发送）",
  "resumeDeliveryInfo.suffix.export": "（导出留档，不代表已实际发送）",

  // ── 版本血缘 ──────────────────────────────────────────────────────
  /** {id} 是父版本记录的编号。 */
  "resumeDeliveryInfo.parent.derivedFrom": "派生自简历 #{id}",

  // ── 空态与错误态（加载失败 ≠ 暂无记录）─────────────────────────────
  "resumeDeliveryInfo.empty.standalone": "独立版本，暂无投递记录",
  "resumeDeliveryInfo.error.loadFailed": "投递记录加载失败（并非「暂无投递记录」），可重试",

  // ── 目的地缺失时的降级文案（不编造公司 / 岗位）───────────────────────
  "resumeDeliveryInfo.destination.missing": "目的地未记录（旧版本快照）",
  "resumeDeliveryInfo.destination.companyUnknown": "（公司未知）",
  "resumeDeliveryInfo.destination.jobUnknown": "（岗位未知）",

  // ── 存档下载 ──────────────────────────────────────────────────────
  "resumeDeliveryInfo.download.action": "下载存档",
  /** {hash} 是产物指纹的前 8 位。 */
  "resumeDeliveryInfo.download.replayed":
    "已下载按存档重新生成的版本（原始产物指纹 {hash}…）；重新生成每次可能略有差异（例如页面随机数），内容与投递当时一致。",
  "resumeDeliveryInfo.download.success": "已下载交付存档",
  "resumeDeliveryInfo.download.failed": "下载交付存档失败",
} as const;

export default resumeDeliveryInfo;
