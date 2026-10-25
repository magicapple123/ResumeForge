// SPDX-License-Identifier: Apache-2.0
/**
 * 生产 data router 的根布局：只做两件"必须包着整个应用"的事。
 *
 * - `useSliderDragGuard`：任何一屏拖滑杆时让 iframe 暂时不吃指针事件（原先挂在 `App` 上，
 *   迁到 data router 后由根布局统一挂，避免生产/测试两条入口各挂一次）；
 * - `DatasetScopeBoundary`：可编辑页面必须等数据集身份冻结后再挂载（在线演示模式跳过，
 *   演示数据不走真实数据集）。
 */
import { Outlet } from "react-router-dom";
import DatasetScopeBoundary from "../DatasetScopeBoundary";
import { useSliderDragGuard } from "../../hooks/useSliderDragGuard";

export default function RootLayout() {
  useSliderDragGuard();
  const outlet = <Outlet />;
  if (import.meta.env.VITE_DEMO_MODE === "1") return outlet;
  return <DatasetScopeBoundary>{outlet}</DatasetScopeBoundary>;
}
