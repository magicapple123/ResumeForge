// SPDX-License-Identifier: Apache-2.0
/**
 * 事件行副行里的「相对时间」（整改 #13）。
 *
 * 通知中心与启动提醒弹窗共用一条事件行，副行要回答"这条是多久以前的"：
 * 今天的一次提醒写成「今天 14:12」，昨天的写「昨天 09:20」，更早的只留「11-20」。
 * 三档就够——绝对日期在副行里既挤又没人读，而"今天/昨天"是最常被扫的两个档。
 *
 * ## 为什么走 `serverTime` 而不是 `new Date()`
 *
 * 后端 `*_at` 是 **naive UTC**（见 `utils/serverTime`），裸 `new Date()` 会把它当本地
 * 时间读，东八区整体早 8 小时，"今天 23:40 的提醒"会显示成"昨天"。这里复用
 * `parseServerTime` / `formatServerTime`，与全站其它时间展示同一套时区口径。
 *
 * ## 为什么同一年只显示月-日
 *
 * 跨年的旧事件要能一眼看出是哪一年，所以只有**不同年**才补年份。多一位数字在 12px
 * 的三级灰里几乎不可见，却会在每条旧事件上重复一次。
 *
 * 文案在 `notifications.relative.*`（通知域）：这两处消费方都是通知/提醒的行，
 * 放同一个域比拆到两处各写一份更不容易漂。
 */
import { t } from "../i18n";
import { formatServerTime, parseServerTime } from "./serverTime";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 把服务端时间戳渲染成副行用的相对时间文案。
 *
 * @param value 服务端时间戳（naive UTC 或带偏移量均可）。空 / 解析失败返回空串——
 *   宁可副行少一段，也不要渲染 "Invalid Date" 或凭空写一个"今天"。
 * @param now 当前时刻，只给测试注入（真实调用不传）。
 * @returns 「今天 14:12」/「昨天 09:20」/「11-20」/「2025-11-20」/ 空串
 */
export function relativeTimeLabel(
  value: string | null | undefined,
  now: Date = new Date(),
): string {
  const date = value ? parseServerTime(value) : null;
  if (!date) return "";

  const iso = date.toISOString();
  const dayKey = formatServerTime(iso, { dateOnly: true });
  const clock = formatServerTime(iso, { timeOnly: true });
  const todayKey = formatServerTime(now.toISOString(), { dateOnly: true });
  const yesterdayKey = formatServerTime(new Date(now.getTime() - DAY_MS).toISOString(), {
    dateOnly: true,
  });

  if (dayKey === todayKey) return t("notifications.relative.today", { time: clock });
  if (dayKey === yesterdayKey) return t("notifications.relative.yesterday", { time: clock });
  // 同年只留「月-日」，跨年补年份：旧事件要能看出是哪一年。
  return dayKey.slice(0, 4) === todayKey.slice(0, 4) ? dayKey.slice(5) : dayKey;
}
