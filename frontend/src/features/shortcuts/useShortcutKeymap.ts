// SPDX-License-Identifier: Apache-2.0
/**
 * 全局 keydown 监听与 handler 注册表（R5）。
 *
 * 监听挂在 `window` 的**捕获阶段**：页面/组件自己的 keydown 处理（比如表格的方向键、
 * 编辑器里的 Tab 缩进）通常挂在冒泡阶段，捕获阶段先到才能保证 `preventDefault()`
 * 真的能拦住。命中后是否拦截还有三条否决：
 *
 * 1. `defaultPrevented`（别人已经处理过）与 `isComposing`（输入法组词中）不碰；
 * 2. AltGraph（AltGr 打字符）不碰；
 * 3. 焦点在输入框/可编辑区、且动作是「撤回/恢复」时不拦截——那里必须交给浏览器原生
 *    的撤销栈，否则用户会觉得"撤回把我的输入吞了"。保存/搜索/助手/新建岗位允许在
 *    输入框里触发：它们都是带修饰键的组合，不会和打字冲突。
 *
 * handler 注册表是**模块级**的：设置页、页面、弹窗都不需要 Provider 也能注册
 * （测试里单独渲染一个页面时不会因为缺 Provider 而报错），Provider 只负责挂监听。
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ShortcutActionId } from "./registry";
import { findBindingActionId, hasAltGraph } from "./matchShortcut";
import { getShortcutSettings, subscribeShortcutSettings, type ShortcutSettings } from "./storage";

export type ShortcutHandler = (event: KeyboardEvent) => void;

/** 动作 id → 已注册的 handler 集合（同一个动作允许多个落点，例如两处表单）。 */
const handlers = new Map<string, Set<ShortcutHandler>>();

/**
 * 录制新组合时置真：此时 keymap 完全让位，否则"按 Cmd+K 录制搜索键"会先把搜索打开。
 * 由设置页的录制态开关，用户松开就恢复。
 */
let recording = false;

export function setShortcutRecording(active: boolean): void {
  recording = active;
}

export function isShortcutRecording(): boolean {
  return recording;
}

export function getShortcutHandlerCount(id: ShortcutActionId): number {
  return handlers.get(id)?.size ?? 0;
}

/**
 * 执行某个动作的所有 handler。返回 false 表示"这个页面上没人认领该动作"——
 * 调用方据此决定**不要** `preventDefault()`，让浏览器保持原样。
 */
export function runShortcut(id: ShortcutActionId, event: KeyboardEvent): boolean {
  const set = handlers.get(id);
  if (!set || set.size === 0) return false;
  // 复制一份再遍历：handler 内部可能触发注册/注销（如关闭弹窗）。
  for (const handler of Array.from(set)) handler(event);
  return true;
}

/** 焦点是否在"会吞掉按键"的可编辑元素里。 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest?.('[contenteditable="true"], [contenteditable=""]'));
}

/** 当前生效的快捷键设置（localStorage 项一变，订阅者立刻拿到新快照）。 */
export function useShortcutSettings(): ShortcutSettings {
  return useSyncExternalStore(subscribeShortcutSettings, getShortcutSettings, getShortcutSettings);
}

/**
 * 注册一个动作的 handler。`enabled` 为假时自动注销（页面不在编辑态、弹窗没开），
 * 于是同一个组合键在别的落点仍然有效。
 */
export function useShortcut(id: ShortcutActionId, handler: ShortcutHandler, enabled = true): void {
  // handler 每次渲染都是新引用（闭包里带着最新状态）：经 ref 转给稳定包装，
  // 避免每次渲染都注销再注册。
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const wrapped: ShortcutHandler = (event) => {
      handlerRef.current(event);
    };
    let set = handlers.get(id);
    if (!set) {
      set = new Set();
      handlers.set(id, set);
    }
    set.add(wrapped);
    return () => {
      const current = handlers.get(id);
      if (!current) return;
      current.delete(wrapped);
      if (current.size === 0) handlers.delete(id);
    };
  }, [enabled, id]);
}

/** 挂全局 keydown 监听。整个应用只需要一处（由 `ShortcutProvider` 调用）。 */
export function useShortcutKeymap(): void {
  const settings = useShortcutSettings();
  const bindingsRef = useRef(settings.bindings);
  useEffect(() => {
    bindingsRef.current = settings.bindings;
  }, [settings]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (recording) return;
      if (event.defaultPrevented || event.isComposing) return;
      if (hasAltGraph(event)) return;
      const id = findBindingActionId(event, bindingsRef.current);
      if (!id) return;
      // 输入框里的撤回/恢复交给原生撤销栈；其余动作照常拦截。
      if ((id === "undo" || id === "redo") && isEditableTarget(event.target)) return;
      if (runShortcut(id, event)) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
