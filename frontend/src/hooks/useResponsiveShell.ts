// SPDX-License-Identifier: Apache-2.0
import { mqMax } from "../theme/breakpoints";
import { useMediaQuery } from "./useMediaQuery";

/**
 * 外壳的折叠状态：**只回答"是/不是折叠"，不回答像素宽度**。
 *
 * 宽度归 CSS（`--rf-sider-width`，见 theme/design-tokens.css）——TS 侧再算一遍就会出现
 * "侧栏 64、主区左边距 200"这种两份真相。这里只有一个布尔，与 `@media (max-width:1092px)`
 * 同源（都用 `BREAKPOINTS.narrow`），所以 `.ant-layout-sider-collapsed` 与宽度永远一致。
 */
export function useResponsiveShell(): { collapsed: boolean } {
  const collapsed = useMediaQuery(mqMax("narrow"));
  return { collapsed };
}
