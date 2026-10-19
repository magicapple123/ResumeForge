/**
 * 全局挂件（R17 / R8）：拖入导入与全局快捷键的落点。
 *
 * 合在一处只是为了让 `App.tsx` 保持可读——它已经接近 500 行预算，而这两个挂件都是
 * "挂上就忘"的：不渲染 UI，只监听窗口事件。
 */
import GlobalFileDrop from "./GlobalFileDrop";
import GlobalShortcuts from "./GlobalShortcuts";

export default function GlobalOverlays() {
  return (
    <>
      <GlobalFileDrop />
      <GlobalShortcuts />
    </>
  );
}
