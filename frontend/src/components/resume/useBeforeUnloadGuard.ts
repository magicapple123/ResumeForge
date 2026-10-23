// SPDX-License-Identifier: Apache-2.0
/** 未保存修改的"刷新/关闭浏览器"守卫（从 `ResumeEditorModal` 的 effect 拆出，纯搬运）。
 *
 *  弹窗开着且脏值还在时挂 `beforeunload`：刷新或关标签页会出原生确认，不再静默丢稿。
 *  反过来说，**只要没有未保存的修改就不挂**——挂着一个不会触发确认的监听只会让
 *  浏览器在部分版本里提示"此页面有未保存的更改"。
 */
import { useEffect } from "react";

/** @param active 是否处于「有未保存修改的打开态」（通常传 `open && dirty`）。 */
export function useBeforeUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome/Edge 只认 returnValue，两者都给。
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);
}

export default useBeforeUnloadGuard;
