// SPDX-License-Identifier: Apache-2.0
/**
 * 复制文本的统一出口（#27A 划词动作的「复制」）。
 *
 * `navigator.clipboard` 在非安全上下文 / 旧浏览器 / jsdom 里不可用，必须回退到
 * 隐藏 textarea + `execCommand("copy")`；两者都失败时返回 `false`，由调用方在浮条上
 * 就地提示"请手动复制"，不弹全局错误。
 */
export async function copyTextToClipboard(
  text: string,
  doc: Document = document,
): Promise<boolean> {
  const value = text.trim();
  if (!value) return false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // 权限被拒 / 页面不可见：继续走 execCommand 回退，不要在这里报错。
  }
  try {
    const area = doc.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "true");
    area.style.position = "fixed";
    area.style.top = "-9999px";
    area.style.opacity = "0";
    doc.body.appendChild(area);
    area.select();
    const copied = typeof doc.execCommand === "function" ? doc.execCommand("copy") : false;
    area.remove();
    return copied;
  } catch {
    return false;
  }
}
