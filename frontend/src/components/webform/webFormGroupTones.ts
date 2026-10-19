/**
 * 「记住这条」弹窗的分组色调（R18）：浅 / 深两套。
 *
 * 这里为什么不用 `--rf-*`：分组色是"同一类里互相区分的 6 个色相"，语义上是**一组**
 * 而不是 6 个独立语义（不存在"这个颜色代表什么状态"）。18 个 CSS 变量换来的可维护性
 * 不如两套 JS 色板——而深色下真正要解决的是"浅底 chip 变成白砖"，两套色板直接解决。
 *
 * 键相同、顺序相同：分组名 → 索引的散列落在同一个索引上，切换主题不会改变"哪组是蓝的"。
 */
import { useResolvedTheme, type ResolvedTheme } from "../../features/theme/themeStore";

export interface GroupTone {
  /** 文字/图标色。 */
  color: string;
  /** 描边色。 */
  border: string;
  /** 展开时的底色。 */
  background: string;
}

export const GROUP_TONE_PALETTES: Record<ResolvedTheme, readonly GroupTone[]> = {
  light: [
    { color: "#2e6da4", border: "#b8d4f2", background: "#f2f7ff" },
    { color: "#247a65", border: "#a9d9cb", background: "#effaf6" },
    { color: "#6344a2", border: "#c8b9ed", background: "#f7f3ff" },
    { color: "#a76720", border: "#f1c58e", background: "#fff8ed" },
    { color: "#a34d5c", border: "#e9b3bd", background: "#fff3f5" },
    { color: "#26728a", border: "#a9d3de", background: "#effaff" },
  ],
  dark: [
    { color: "#9dc3ef", border: "#3b5b86", background: "#1c2a3d" },
    { color: "#74d7a4", border: "#2f5c49", background: "#16281f" },
    { color: "#b9a8f5", border: "#4a3f74", background: "#221f33" },
    { color: "#f2c66d", border: "#6b5220", background: "#2b2415" },
    { color: "#ff9a91", border: "#6b3a41", background: "#2b1a1e" },
    { color: "#8fd8f8", border: "#2b5468", background: "#14242b" },
  ],
};

/** 分组名 → 稳定色调（同名永远同色，主题切换时索引不变）。 */
export function groupToneFor(group: string, theme: ResolvedTheme): GroupTone {
  const tones = GROUP_TONE_PALETTES[theme];
  let hash = 0;
  for (const char of group) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return tones[Math.abs(hash) % tones.length];
}

/** 组件里取某一个分组的色调（跟随主题）。 */
export function useGroupTone(): (group: string) => GroupTone {
  const theme = useResolvedTheme();
  return (group: string) => groupToneFor(group, theme);
}
