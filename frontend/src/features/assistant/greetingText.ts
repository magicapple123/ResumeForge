// SPDX-License-Identifier: Apache-2.0
/** 分时段问候：深夜/凌晨补一句关怀，其余时段不画蛇添足。 */

import { t } from "../../i18n";

export interface AssistantGreeting {
  /** 固定主打招呼。 */
  headline: string;
  /** 时段关怀语；绝大多数小时没有，避免每条都唠叨。 */
  care?: string;
}

export function greetingForHour(hour: number): AssistantGreeting {
  // t() 只能在函数体内求值：模块作用域取文案会在切换语言后停在旧值。
  const headline = t("assistantUi.greeting.headline");
  // 深夜/凌晨（23 点-次日 5 点前）赶着改简历的人不少，投投该提醒休息而不是只顾干活；
  // 用本机时间即可——简历通是本地单用户应用，浏览器时间就是用户的真实当地时间。
  if (hour >= 23 || hour < 5) {
    return { headline, care: t("assistantUi.greeting.lateNight") };
  }
  return { headline };
}
