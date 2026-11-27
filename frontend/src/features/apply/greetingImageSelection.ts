// SPDX-License-Identifier: Apache-2.0
/**
 * 配图选择的三条纯规则：切换、移除、把 id 还原成选项。
 *
 * ## 为什么从组件里拿出来
 *
 * R21 的两条验收是"否定式"的——「× 只移除、不删库」与「第 5 张不许静默忽略」。
 * 这两条如果只写在 JSX 里，只能靠"点了之后看有没有调接口"来断言；写成纯函数后可以直接
 * 说清规则，组件只剩"把结果画出来"，也就不必为了测一条规则去挂载一个 antd 树。
 *
 * ## 为什么 `blocked` 要单独回一个标志
 *
 * 上限拦下时**不能什么都不做**：用户点了第 5 张、界面毫无反应，看起来就是"坏了"。
 * 组件拿到 `blocked` 之后必须给一句原因（`applyQueue.image.maxReached`），而不是静默吞掉。
 */
import type { ApplyGreetingImageOption } from "../../types";
import { GREETING_IMAGE_MAX_FALLBACK } from "../../types";

/** 一次点击的结果；三个字段互斥组合，组件按它决定"改值 / 提示原因 / 什么都不变"。 */
export interface GreetingImageToggleResult {
  /** 点击之后应当写回表单的值（`blocked` 时与入参等值）。 */
  next: number[];
  /** 被上限挡下：值没变，界面要说明原因。 */
  blocked: boolean;
  /** 这次点击是"取消选择"——上限不拦取消。 */
  removed: boolean;
}

/**
 * 把"张数上限"归一到可用的正整数。
 *
 * 后端下发的值正常是 1..N，但接口没回包 / 回包被清空时会拿到 `undefined` 或 0；
 * 这时必须回落到兜底值，而不是让 `length >= 0` 把第一张就拦掉。
 */
export function greetingImageLimit(maxCount?: number | null): number {
  if (typeof maxCount === "number" && Number.isFinite(maxCount) && maxCount > 0) {
    return Math.floor(maxCount);
  }
  return GREETING_IMAGE_MAX_FALLBACK;
}

/**
 * 点一张图：已选则取消，未选且还有额度则追加，未选但已满则拦下。
 *
 * 返回新数组（不改入参）：值来自 antd Form，原地改会让"是否有变化"的判断失效。
 */
export function toggleGreetingImage(
  current: readonly number[],
  id: number,
  maxCount?: number | null,
): GreetingImageToggleResult {
  if (current.includes(id)) {
    return { next: current.filter((item) => item !== id), blocked: false, removed: true };
  }
  const limit = greetingImageLimit(maxCount);
  if (current.length >= limit) {
    return { next: [...current], blocked: true, removed: false };
  }
  return { next: [...current, id], blocked: false, removed: false };
}

/** 从这一条移除（**不删库**）：只把 id 从已选列表里摘掉，不碰 `user_file`。 */
export function removeGreetingImage(current: readonly number[], id: number): number[] {
  return current.filter((item) => item !== id);
}

/**
 * 已选 id → 选项对象，**保持已选顺序**（缩略图顺序 = 用户挑选顺序，不按库里的排列重排）。
 *
 * 库里已不存在的 id 直接跳过：那说明图片在别处被删了，画一个没有名字、没有缩略图的空槽
 * 只会更让人困惑。
 */
export function resolveGreetingImages(
  selected: readonly number[],
  options: readonly ApplyGreetingImageOption[],
): ApplyGreetingImageOption[] {
  const byId = new Map(options.map((option) => [option.id, option]));
  const resolved: ApplyGreetingImageOption[] = [];
  for (const id of selected) {
    const option = byId.get(id);
    if (option) resolved.push(option);
  }
  return resolved;
}

/**
 * 选项集合的签名，用于渲染期镜像同步。
 *
 * 父组件每次渲染都可能新建数组；按"真的变了"（id / 可删性 / 名字）比较再灌本地副本，
 * 避免 `setState` → 重渲染的死循环。名字进签名是因为上传后同名文件会被后端改名。
 */
export function greetingImageSignature(options: readonly ApplyGreetingImageOption[]): string {
  return options
    .map((option) => `${option.id}:${option.deletable ? 1 : 0}:${option.name}`)
    .join(",");
}
