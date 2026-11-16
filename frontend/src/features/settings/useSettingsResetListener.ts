// SPDX-License-Identifier: Apache-2.0
/**
 * 订阅「恢复默认」成功事件（I-10）——卡片侧的**唯一**感知入口。
 *
 * ## 为什么用事件而不是回调链
 *
 * 恢复默认可从三种地方发起（卡片头部、字段级 `↺`、快照导入），而"重置之后该重取什么"
 * 只有卡片自己知道。把「谁发起」与「谁刷新」解耦，卡片就不用被父级塞一个 `onAfterReset`
 * 属性层层透传；新增一张卡只加一行订阅，不改任何调用点。
 *
 * ## 为什么用 ref 持有回调
 *
 * 卡片传进来的通常是内联箭头函数，每次渲染都是新引用。直接写进 `deps` 会让订阅每次渲染
 * 都拆装一遍（重置事件恰好落在两次渲染之间就会静默丢事件）。ref 只保存"最新的那个回调"，
 * 订阅本身只在挂载/卸载时发生一次。
 */
import { useEffect, useRef } from "react";
import { SETTINGS_RESET_EVENT } from "./SettingsResetButton";
import type { ResetResult } from "./useSettingsReset";

/** 重置事件的处理函数：参数是后端回传的重置结果（事件没带 detail 时为 `null`）。 */
export type SettingsResetHandler = (result: ResetResult | null) => void;

/**
 * 在「恢复默认」成功后执行一次 `handler`（通常就是卡片自己的取数函数）。
 *
 * 用法：`useSettingsResetListener(() => void load())`。
 */
export function useSettingsResetListener(handler: SettingsResetHandler): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const onReset = (event: Event) => {
      // `CustomEvent.detail` 在跨窗口/手工派发时可能是 undefined：按 null 处理，
      // 让卡片一律走"重新取数"这条路径，而不是依赖事件里带了什么。
      const detail = (event as CustomEvent<ResetResult | undefined>).detail;
      handlerRef.current(detail ?? null);
    };
    window.addEventListener(SETTINGS_RESET_EVENT, onReset);
    return () => window.removeEventListener(SETTINGS_RESET_EVENT, onReset);
  }, []);
}
