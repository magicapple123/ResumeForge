// SPDX-License-Identifier: Apache-2.0
/**
 * 把模型返回的长文本按空行切成段落。
 *
 * 单独一个文件而不是挂在组件里：参考答案与改写示范都要用它，而组件文件导出非组件
 * 会触发 `react-refresh/only-export-components`（热更新会整块失效）。
 */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
