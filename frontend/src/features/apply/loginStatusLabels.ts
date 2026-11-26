// SPDX-License-Identifier: Apache-2.0
/**
 * 登录状态的**状态 → 颜色 / 文案**映射（登录状态抽屉与站点表格共用一份）。
 *
 * 单独成文件的理由：`react-refresh/only-export-components` —— 组件文件里再导出常量或
 * 函数会让热更新退化成整页刷新（与 `components/common/rowActionMenu.ts` 拆出去的同一
 * 条理由）。这些映射是"数据"，不是组件，本就不该和 JSX 放一起。
 *
 * 措辞红线：`unknown` 一律「无法判断」，**绝不写「已失效」**（误报会逼用户反复重登）；
 * 「已失效」（`expired`）只留给后端明确判定为过期的那种。
 */
import type { LoginStatusValue } from "../../api/loginStatus";
import { t } from "../../i18n";

/** 状态 → 胶囊色。未登录是可操作状态（去登录就行），用琥珀；「已失效」才用红。 */
export const STATUS_COLOR: Record<LoginStatusValue, string> = {
  ok: "success",
  "logged-out": "warning",
  expired: "error",
  unknown: "default",
  unchecked: "default",
};

/** 状态 → 文案 key 的映射写死成表：`t()` 的键是字面量联合类型，模板串拼出来的键过不了类型检查。 */
const STATUS_LABEL_KEY = {
  ok: "applyUi.loginStatus.status.ok",
  "logged-out": "applyUi.loginStatus.status.logged-out",
  expired: "applyUi.loginStatus.status.expired",
  unknown: "applyUi.loginStatus.status.unknown",
  unchecked: "applyUi.loginStatus.status.unchecked",
} as const;

/** 状态文案。站点表格与来源卡片共用一份，避免两处措辞漂移。 */
export function statusLabel(status: LoginStatusValue): string {
  return t(STATUS_LABEL_KEY[status]);
}

/**
 * ISO 时间串里的日期/时间分隔符换成空格：`2026-11-13T10:00:00` → `2026-11-13 10:00:00`。
 *
 * 只影响**展示**（后端下发的是 ISO 串，面板按"人看的样子"写）；不做时区换算——
 * 换算了反而与后端日志对不上。这里用正则而不是 `replace("T", " ")`：后者会把一个
 * 单字母字面量塞进界面文案链路，i18n 守卫会把它当成"未登记的英文文案"。
 */
export function isoTimeText(value: string): string {
  return value.replace(/T/u, " ");
}
