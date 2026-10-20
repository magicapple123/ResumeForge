// SPDX-License-Identifier: Apache-2.0
/**
 * 全局快捷键的落点（R8）：主题切换、打开设置、打开助手技能。
 *
 * 为什么集中在这一个组件里：这三个动作"在哪都能按"，落点就是"整个应用"本身。
 * 分散到各页面注册会出现"在 A 页能用、B 页按了没反应"。其余动作（撤回/保存/搜索…）
 * 由各自页面注册，因为它们只在特定的编辑上下文里成立。
 */
import { useNavigate } from "react-router-dom";
import { useShortcut } from "../features/shortcuts/useShortcutKeymap";
import { toggleTheme } from "../features/theme/themeStore";

export default function GlobalShortcuts() {
  const navigate = useNavigate();

  useShortcut("toggleTheme", (event) => {
    event.preventDefault();
    toggleTheme();
  });
  useShortcut("openSettings", (event) => {
    event.preventDefault();
    navigate("/settings");
  });
  useShortcut("openSkills", (event) => {
    event.preventDefault();
    navigate("/skills");
  });

  return null;
}
