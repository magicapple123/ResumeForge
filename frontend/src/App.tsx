// SPDX-License-Identifier: Apache-2.0
import { Routes } from "react-router-dom";
import { APP_ROOT_ROUTE } from "./appRoutes";

// 保留原来的导出位置：首页快捷入口（ShortcutsCard）与在线演示测试从这里取完整导航清单。
// 直接从 navigationConfig 再导出，避免 App.tsx 为了"顺手带一个常量"重新依赖导航实现。
export { MENU_ITEMS } from "./components/navigation/navigationConfig";

/**
 * 测试与嵌入场景的声明式路由外壳。
 *
 * **生产入口不走这里**：`main.tsx` 用 `createBrowserRouter`（data router）挂同一棵
 * `APP_ROOT_ROUTE`——资料页的 `useBlocker` 只在 data router 内可用。这里保留
 * `<Routes>` 是为了既有测试用 `MemoryRouter` 渲染 App 的写法不变；路由表本身
 * 来自 `appRoutes.tsx`，两边不会漂移。
 */
export default function App() {
  return <Routes>{APP_ROOT_ROUTE}</Routes>;
}
