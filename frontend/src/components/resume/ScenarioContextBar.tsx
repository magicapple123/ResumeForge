// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台顶部的**只读**场景上下文条（A6 最小整合）。
 *
 * 数据只来自这份简历自己的 context_snapshot（服务端在生成时冻结）：
 * - null / 未记录 → 「本次场景：未使用」（旧简历与未启用场景的简历都是这个形态）；
 * - 有值 → 「本次场景：<display_name>」。
 *
 * 只读：不提供切换入口、不回填当前场景、不参与保存/草稿/撤销——历史记录 NULL
 * 就是"当时没有记录"，不能按今天的选择补写。
 *
 * 它还承担一行高度 + children 的纵向堆叠（三栏容器作为 children 吃满剩余高度），
 * 这样宿主 ResumeZoomModal 只多一行渲染调用。
 */
import { Typography } from "antd";
import type { CSSProperties, ReactNode } from "react";
import { t } from "../../i18n";
import type { GenerationContextSnapshot } from "../../types";

/** 上下文条 + 三栏容器的纵向堆叠（条占一行，三栏吃满剩余高度）。 */
const STACK_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: "1 1 auto",
  width: "100%",
  minHeight: 0,
};

interface Props {
  snapshot?: GenerationContextSnapshot | null;
  /** 制作台三栏容器（放在上下文条下方）。 */
  children?: ReactNode;
}

export default function ScenarioContextBar({ snapshot, children }: Props) {
  const name = snapshot?.display_name?.trim() || t("careerScenarios.context.unused");
  return (
    <div className="resume-wb-stack" style={STACK_STYLE}>
      <div
        className="resume-wb-scenario-bar"
        role="status"
        aria-label={t("careerScenarios.context.aria")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flex: "0 0 auto",
          padding: "2px 16px 6px",
          borderBottom: "1px solid var(--rf-border-subtle)",
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("careerScenarios.context.text", { name })}
        </Typography.Text>
      </div>
      {children}
    </div>
  );
}
