// SPDX-License-Identifier: Apache-2.0
/** 批量参数卡里的一行：左标签、右控件，窄档自动上下堆叠。 */
import type { ReactNode } from "react";

export default function BatchConfigRow({
  label,
  hint,
  children,
  wide = false,
  span2 = false,
}: {
  label: string;
  /** 可选字段的轻提示（如「可选」）。 */
  hint?: string;
  children: ReactNode;
  /** 长文本控件独占一行。 */
  wide?: boolean;
  /** 两个控件并排的短字段占两列（如 AI 润色的开关 + 档位）。 */
  span2?: boolean;
}) {
  const modifier = wide ? " is-wide" : span2 ? " is-span-2" : "";
  return (
    <div className={`batch-config-row${modifier}`}>
      <span className="batch-config-label">
        {label}
        {hint ? <span className="batch-config-hint">{hint}</span> : null}
      </span>
      <div className="batch-config-control">{children}</div>
    </div>
  );
}
