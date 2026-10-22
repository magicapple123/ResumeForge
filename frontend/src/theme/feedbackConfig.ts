// SPDX-License-Identifier: Apache-2.0
/**
 * 结果反馈（Toast）的全局口径。
 *
 * 挂在 `<AntdApp message={MESSAGE_CONFIG}>` 上，一处生效于全仓 620 次 `message.*` 调用，
 * 不逐个改调用点。**显式传了 `duration` 的调用点不受影响**（如 `utils/taskNotify.ts`
 * 的批次完成通知）；`notification` 走自己的配置，与这条无关。
 */
export const MESSAGE_CONFIG = {
  /** 规范要求 2–3 秒；取 2.5，比 antd 默认的 3 短半拍。 */
  duration: 2.5,
  /** 同时最多 3 条，第 4 条起替换最旧的一条（antd 默认无限堆叠）。 */
  maxCount: 3,
  /** 悬停暂停计时：用户正在读的时候不要消失得比读完更快。 */
  pauseOnHover: true,
} as const;
