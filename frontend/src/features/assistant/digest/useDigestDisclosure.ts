// SPDX-License-Identifier: Apache-2.0
/**
 * 今日简报的展开状态：默认展开，用户收起后记住（localStorage）。
 *
 * 存储失败（隐私模式 / 配额满）只影响「记住」，折叠本身照常工作——不能因为 localStorage
 * 抛错就点不动。展开时接 Escape 收起，与其它浮层同一套按键习惯。
 */
import { useCallback, useEffect, useState } from "react";

export const DIGEST_EXPANDED_KEY = "assistant.digest.expanded";

function initialOpen(): boolean {
  try {
    return localStorage.getItem(DIGEST_EXPANDED_KEY) !== "false";
  } catch {
    return true;
  }
}

export function useDigestDisclosure() {
  const [open, setOpen] = useState(initialOpen);
  const changeOpen = useCallback((next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(DIGEST_EXPANDED_KEY, String(next));
    } catch {
      /* The disclosure still works if preferences cannot be stored. */
    }
  }, []);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") changeOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, changeOpen]);
  return { open, changeOpen };
}
