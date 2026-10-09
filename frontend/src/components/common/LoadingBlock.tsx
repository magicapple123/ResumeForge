/**
 * 通用加载占位块：独立的 Spin（居中、带最小高度）或嵌套包裹 children。
 *
 * 两种模式：
 * - 无 children：一个居中的 Spin，minHeight 默认读 CSS 变量
 *   `--rf-loading-min-h`（见 styles/modules.css），避免加载区塌成一条线。
 * - 有 children：antd Spin 的嵌套包裹模式，children 上盖遮罩。
 *
 * 对外 API 仍用 antd 惯用的 `size: "default"` 与 `tip`（调用方零成本迁移），
 * 内部映射到 antd 6 的新写法：`size="medium"`、`description`（旧名已 deprecated）。
 */
import { Spin } from "antd";
import type { CSSProperties, ReactNode } from "react";

interface Props {
  /** Spin 尺寸，与 antd 对齐。 */
  size?: "small" | "default" | "large";
  /** 加载提示文案（嵌套包裹模式下显示在遮罩上）。 */
  tip?: string;
  /** 无 children 模式下外层容器的最小高度（px）；缺省读 --rf-loading-min-h。 */
  minHeight?: number;
  /** 传入时进入嵌套包裹模式。 */
  children?: ReactNode;
}

export default function LoadingBlock({ size = "default", tip, minHeight, children }: Props) {
  // antd 6 把 Spin 的 "default" 改名为 "medium"，这里兜一层映射。
  const spinSize = size === "default" ? "medium" : size;

  if (children !== undefined && children !== null) {
    return (
      <Spin size={spinSize} description={tip}>
        {children}
      </Spin>
    );
  }

  const style: CSSProperties = {
    minHeight: minHeight ?? "var(--rf-loading-min-h)",
  };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", ...style }}>
      <Spin size={spinSize} description={tip} />
    </div>
  );
}
