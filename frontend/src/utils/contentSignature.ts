// SPDX-License-Identifier: Apache-2.0
/**
 * 简历内容签名（纯函数）：给"这份内容我扫过了"一个可比较的指纹。
 *
 * 用途只有一个——风险扫描完成后，如果用户接着改了正文，要能提示「简历内容已修改，
 * 建议重新扫描」。所以它必须满足：
 * 1. **稳定**：同样的内容任何时候都得到同样的串（不用随机数、不用时间戳、不缓存在
 *    模块级状态里）；
 * 2. **便宜**：每次 content 变化都要算一遍，不能做深度 diff；
 * 3. **足够区分**：字段顺序变化、一个字的差异都要变。
 *
 * 做法是 FNV-1a（32 位）逐字符哈希 + 长度前缀：`JSON.stringify` 保证按键序序列化，
 * 长度前缀让"哈希碰撞"这类极端情况至少还能靠长度区分。
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 把任意可序列化内容压成一个短签名（小写 36 进制，含长度）。 */
export function contentSignature(content: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(content) ?? "";
  } catch {
    // 理论上不会有循环引用（简历内容是纯数据结构）；万一有也不能让面板崩。
    text = String(content);
  }
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    // Math.imul 保证 32 位整数乘法不被浮点精度吃掉。
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return `${text.length.toString(36)}-${hash.toString(36)}`;
}
