// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台 v2 的键盘撤销/恢复。
 *
 * 复用全站快捷键体系（设置页可改键、输入框内 undo/redo 让给浏览器原生）：
 * 这里只把两个动作接到统一历史上，一次快捷键 = 历史栈的一步。
 *
 * 单独成文件而不是塞进 ResumeWorkbenchV2：该外壳已接近行数预算，而且这两个注册
 * 不依赖外壳的任何状态，只依赖 history 的两个回调。
 */
import { useShortcut } from "../../features/shortcuts/useShortcutKeymap";

interface Options {
  undo: () => void;
  redo: () => void;
  enabled?: boolean;
}

export function useWorkbenchV2Shortcuts({ undo, redo, enabled = true }: Options): void {
  useShortcut("undo", () => undo(), enabled);
  useShortcut("redo", () => redo(), enabled);
}
