// SPDX-License-Identifier: Apache-2.0
/**
 * 全局挂件（R17 / R8 / D）：拖入导入、全局快捷键与全站搜索弹层的落点。
 *
 * 合在一处只是为了让 `App.tsx` 保持可读——它已经接近 500 行预算，而这三个挂件都是
 * "挂上就忘"的：不渲染常驻 UI，只监听窗口事件（搜索仍保留 ⌘/Ctrl+K 与弹层）。
 */
import GlobalFileDrop from "./GlobalFileDrop";
import GlobalSearch from "./GlobalSearch";
import GlobalShortcuts from "./GlobalShortcuts";

export default function GlobalOverlays() {
  return (
    <>
      <GlobalFileDrop />
      <GlobalSearch showTrigger={false} />
      <GlobalShortcuts />
    </>
  );
}
