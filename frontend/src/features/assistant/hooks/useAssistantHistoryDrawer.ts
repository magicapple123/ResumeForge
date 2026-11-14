// SPDX-License-Identifier: Apache-2.0
/**
 * 平板档（≤1092 且 >767）把历史列表从"压成 220px 横条"改成抽屉（方案 §4.8）。
 *
 * 为什么要换：横条把消息区高度吃掉 220px，而 768 高的屏本来就紧；抽屉只在需要时出现，
 * 关掉就把高度还给对话。≤767 保持原样——手机档的横条是 `mobile.css` 里成型的形态。
 * 浮窗（`compact`）有自己的浮层，不参与。
 */
import { useEffect, useState } from "react";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { mqMax } from "../../../theme/breakpoints";

export function useAssistantHistoryDrawer(
  compact: boolean,
  /** 浮窗历史浮层是否展开（与抽屉无关，只用于 Esc 关闭）。 */
  floatingHistoryOpen: boolean,
  setFloatingHistoryOpen: (open: boolean) => void,
) {
  const narrowViewport = useMediaQuery(mqMax("narrow"));
  const phoneViewport = useMediaQuery(mqMax("phone"));
  const drawerVisible = narrowViewport && !phoneViewport && !compact;
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 浮窗的历史抽屉是盖在内容上的：除了点背板，键盘用户还需要一条直接退出的路。
  useEffect(() => {
    if (!compact || !floatingHistoryOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFloatingHistoryOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [compact, floatingHistoryOpen, setFloatingHistoryOpen]);

  return { drawerVisible, drawerOpen, setDrawerOpen };
}
