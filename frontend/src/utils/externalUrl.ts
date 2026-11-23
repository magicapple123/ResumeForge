// SPDX-License-Identifier: Apache-2.0
/**
 * 外链安全：把用户/模型给的字符串变成一个「可以放心塞进 `href`」的地址。
 *
 * 为什么独立成 `utils/`：这段逻辑原先住在 `features/assistant/assistantUtils.ts`，
 * 求职进度卡片的「打开关联链接」也要用同一份。让 tracker 去 import assistant 的工具
 * 会造成**域之间的反向依赖**（求职进度不该依赖助手），所以提到中立位置，
 * assistant 侧改成 re-export 保持既有 import 路径不变。
 *
 * 判定刻意只看协议：`javascript:` 是可执行脚本、`file:` / `data:` 能读本地或注入内容，
 * 它们都会被渲染成 `<a href>`，等于把输入变成攻击面。解析失败一律返回 `null`，
 * 由调用方退化成纯文本——**一个能点却跳到别处的链接，比没有链接更糟**。
 */

/** 只放行 http / https；其余（含解析失败）返回 `null`。 */
export function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
