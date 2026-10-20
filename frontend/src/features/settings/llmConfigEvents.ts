// SPDX-License-Identifier: Apache-2.0
/**
 * 「大模型配置变了」的广播（本轮新增）。
 *
 * 页头的模型下拉与「设置 → AI 模型」是两棵互不相识的子树：设置保存/启用/删除之后，
 * 下拉只有在下一次路由变化或刷新页面时才重新取数，用户看到的就是"设置里换了模型，
 * 顶上还显示旧的"。
 *
 * 这里只做一件事：让**写操作**通知**读操作**重新取一次。没有共享状态、没有缓存，
 * 订阅方仍然自己调 API——避免再造一份"谁是权威"的问题（与 `resumeListEvents` 同构）。
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/** 配置发生写入后调用：所有订阅方立刻重新取数。 */
export function bumpLLMConfig(): void {
  for (const listener of listeners) listener();
}

/** 订阅；返回取消订阅函数（组件卸载时务必调用）。 */
export function subscribeLLMConfig(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 测试用：清空订阅（避免用例之间互相影响）。 */
export function resetLLMConfigListenersForTests(): void {
  listeners.clear();
}
