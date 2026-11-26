// SPDX-License-Identifier: Apache-2.0
/**
 * 深链 `?reminder=N` 的消费（整改 #13）：提醒列表就绪后把那条挑出来交给调用方。
 *
 * ## 为什么从 ReminderPanel 拆出来
 *
 * `ReminderPanel` 已经在 500 行预算的边缘（本批加了深链之后到 504 行）。
 * 深链这一段是**自成一体的状态机**（等就绪 → 只消费一次 → 找到就开 / 找不到就报），
 * 搬走它比继续往面板里塞更容易读懂，也不影响面板的列表/表单逻辑。
 *
 * ## 三条口径
 *
 * 1. **必须等列表加载完再判断**：`items` 还是空数组时下结论，会把"还没拉到"误判成"已删除"。
 * 2. **同一个 id 只消费一次**（`handledId`）：抽屉关掉之后宿主会把 URL 参数 replace 掉，
 *    但万一参数还留着同一个 id，也不该被重新弹开——那会变成关不掉的抽屉。
 * 3. **找不到也要回报**：提醒可能已软删、也可能不在当前类型筛选里。调用方据此说清原因并
 *    清掉参数，**不开一个只有默认标题的空抽屉**（旧实现会那样，读起来像"页面坏了"）。
 *
 * 两个回调由调用方提供并需保持引用稳定（`useCallback`）：它们进 effect 依赖，
 * 每次渲染都换新的会让这条 effect 每帧重跑。
 */
import { useEffect, useState } from "react";
import type { Reminder } from "../../types";

export interface ReminderDeepLinkOptions {
  /** URL 里的 `?reminder=N`；`null` = 没有深链。 */
  initialReminderId: number | null;
  /** 列表是否仍在加载：加载中不下结论。 */
  loading: boolean;
  /** 当前列表（服务端已按类型筛选过的结果）。 */
  items: Reminder[];
  /** 找到了：调用方负责打开详情抽屉。 */
  onOpen: (item: Reminder) => void;
  /** 列表里没有这一条：调用方负责提示原因并清掉 URL 参数。 */
  onNotFound: () => void;
}

export function useReminderDeepLink({
  initialReminderId,
  loading,
  items,
  onOpen,
  onNotFound,
}: ReminderDeepLinkOptions): void {
  // 已经消费过的 id（同一个 id 不重复开抽屉）。
  const [handledId, setHandledId] = useState<number | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- 必须等列表就绪才能判断"这条在不在"，
     渲染期拿不到这个结论；且只消费一次（handledId 守卫），不是每帧同步状态。 */
  useEffect(() => {
    if (initialReminderId === null || loading) return;
    if (handledId === initialReminderId) return;
    setHandledId(initialReminderId);
    const target = items.find((item) => item.id === initialReminderId);
    if (target) {
      onOpen(target);
      return;
    }
    onNotFound();
  }, [initialReminderId, loading, items, handledId, onOpen, onNotFound]);
  /* eslint-enable react-hooks/set-state-in-effect */
}
