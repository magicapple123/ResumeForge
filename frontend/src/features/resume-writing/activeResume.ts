// SPDX-License-Identifier: Apache-2.0
/**
 * 「写作增强」的简历作用域（2026-10-24：入口从编辑器页签搬到右键菜单）。
 *
 * ## 为什么需要它
 *
 * 右键菜单是**全局**的（`AiPolishLayer` 挂在 `MainLayout` 根节点，才能听见弹窗里的选区）。
 * 而写作增强的四个动作都要 `resume_id`（`POST /resumes/{id}/writing/*`）。中间缺的
 * 就是"现在在看哪份简历"这条信息，由打开详情弹窗的那一层登记进来。
 *
 * ## 为什么不用 Context
 *
 * 发布方（`ResumeDetailModal`）渲染在 `AiPolishLayer` **下面**，Provider 包不住它；
 * 硬包一层就得把状态提到路由之上，而路由那层并不知道用户点开了哪份简历。这里用一个
 * 极小的外部 store：**最后打开的那份简历生效，关闭即清空**。两个弹窗叠开的情况本来
 * 就不存在（详情弹窗是单例），真出现也只会以最后打开的为准，不会互相覆盖成随机值。
 *
 * ## 没有登记时不显示这一项
 *
 * 菜单项只在有简历作用域时出现：在岗位、资料、助手这些页面选中文字右键，写作增强
 * 没有可以归属的简历，摆出来也点不动。
 */
import { useSyncExternalStore } from "react";

let current: number | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** 登记"当前打开的简历"；`null` = 关闭。同一个 id 重复登记不会触发重渲染。 */
export function setActiveWritingResume(resumeId: number | null): void {
  if (current === resumeId) return;
  current = resumeId;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 当前登记的简历 id；没有时返回 `null`（右键菜单据此决定是否显示「写作增强」）。 */
export function useActiveWritingResume(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    // 服务端渲染没有"打开的简历"这回事；返回 null 与服务端输出一致。
    () => null,
  );
}
