// SPDX-License-Identifier: Apache-2.0
/**
 * 「当前有未保存草稿」的全局登记表。
 *
 * 设置页的「重新加载界面」会整页重载——这本身不危险，但**有未保存修改时点它等于丢稿**。
 * 判断"有没有稿没保存"没有全局答案：制作台看 `documentDirty`、资料页看表单 dirty、
 * 弹窗看各自的 dirty。它们已有的共同出口是 `useBeforeUnloadGuard`（脏了才挂），
 * 所以这里让守卫在挂载期登记，卡片订阅这份登记表决定按钮是否可点。
 *
 * 用计数而不是布尔：守卫可能同时挂不止一个（弹窗叠在页面上），任一个退订都不能把
 * "还有别的稿没保存"抹掉。
 */
import { useSyncExternalStore } from "react";

const active = new Set<string>();
const listeners = new Set<() => void>();
let seq = 0;

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/** 登记一份"有未保存草稿"，返回退订函数（组件卸载 / 变干净时调用）。 */
export function registerUnsavedDraft(): () => void {
  const key = `draft#${(seq += 1)}`;
  active.add(key);
  emit();
  return () => {
    if (active.delete(key)) emit();
  };
}

/** 是否有任何一处未保存草稿。 */
export function hasUnsavedDrafts(): boolean {
  return active.size > 0;
}

export function subscribeUnsavedDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 订阅版本：草稿出现/消失时触发重渲染。 */
export function useUnsavedDrafts(): boolean {
  return useSyncExternalStore(subscribeUnsavedDrafts, hasUnsavedDrafts, () => false);
}
