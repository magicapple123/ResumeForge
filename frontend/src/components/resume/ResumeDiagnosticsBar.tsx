// SPDX-License-Identifier: Apache-2.0
/**
 * 详情顶部的「诊断与说明」一行（2026-11 问题 8 方案 A）。
 *
 * 压的是**形态**，不是信息：原来「生成说明 / 版面诊断 / 未收录资料 / 内容来源」各自占一整
 * 段、纵向线性排列，四段加起来 ≈136px，把 A4 纸面推到首屏之外。现在四个入口并成一行按钮，
 * 点开用 `Popover` 展示**原来的内容组件**（`RationaleParagraphs` / `ResumeCoverageNotes` 的
 * 正文 / `EvidencePanel` / 版面诊断卡）——解析与渲染逻辑一行都没搬进来。
 *
 * 三条刻意保留的东西：
 * - **条数在视觉与读屏里都要有**：徽标只是视觉，`aria-label` 里必须带数字（"未收录 31 条"），
 *   否则读屏用户只会听到三个没有下文的词；
 * - **入口必须是真 `<Button>`**：键盘 `Tab` 能依次到达、`Enter` / `Space` 打开；
 *   `Popover` 自带 `Esc` 关闭，不需要自己接键。
 * - **版面诊断的琥珀语义有专属通道**（`attention`）：它是"偏空 / 溢出"的警告，不能退化成
 *   灰色数字——条目标题前那颗点就是它。
 *
 * 只用容器查询调窄版（不用视口断点）：宿主是弹窗/抽屉，宽度由用户拖动决定。
 */
import { Button, Popover, Tag } from "antd";
import type { ReactNode } from "react";
import { useI18n } from "../../i18n/i18nContext";

/** 版面诊断入口：内容 + 徽标文字（"偏空 · 占用 81%"）+ 是否需要琥珀提示。 */
export interface DiagnosisEntry {
  content: ReactNode;
  /** 状态摘要；还没算出来时为 null（只显示入口名）。 */
  badge?: string | null;
  /** 偏空 / 拥挤 / 溢出 = true；健康 = false。 */
  attention?: boolean;
}

interface Props {
  diagnosis?: DiagnosisEntry | null;
  /** 未收录资料：正文是 `ResumeCoverageNotesBody` 的渲染结果，`count` 用于徽标与读屏名。 */
  coverage?: { content: ReactNode; count: number } | null;
  /** 内容来源说明：正文是 `EvidencePanel`（embedded），`count` 是标注条数。 */
  evidence?: { content: ReactNode; count: number } | null;
  /** 生成说明：正文是 `RationaleParagraphs`。 */
  rationale?: ReactNode | null;
}

interface EntryProps {
  /** 入口文案（短标签）。 */
  label: string;
  /** 读屏名：必须自带条数或状态，不能只有视觉徽标。 */
  ariaLabel: string;
  /** 徽标文字（条数或状态摘要）；为空时不渲染徽标。 */
  badge?: string | null;
  /** 徽标是否是警告语义（琥珀色）。 */
  attention?: boolean;
  /** 弹层里的内容。 */
  children: ReactNode;
}

/**
 * 单个入口。`Popover` 的 `trigger="click"` 对 `<Button>` 生效：
 * 键盘聚焦后按 `Enter` / `Space` 走的是按钮的 click，`Esc` 由 antd 的浮层自己关。
 */
function DiagnosticsEntry({ label, ariaLabel, badge, attention, children }: EntryProps) {
  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      // 31 条清单在弹层里可能很长：限高 + 内部滚动（不为此改成抽屉，会又开一层遮罩）。
      content={<div className="resume-diagnostics-popover">{children}</div>}
    >
      <Button type="text" size="small" className="resume-diagnostics-entry" aria-label={ariaLabel}>
        {attention ? <span className="resume-diagnostics-dot" aria-hidden /> : null}
        <span>{label}</span>
        {badge ? (
          <Tag
            className={`resume-diagnostics-count${attention ? " is-attention" : ""}`}
            style={{ marginInlineEnd: 0 }}
          >
            {badge}
          </Tag>
        ) : null}
      </Button>
    </Popover>
  );
}

export default function ResumeDiagnosticsBar({ diagnosis, coverage, evidence, rationale }: Props) {
  const { t } = useI18n();
  if (!diagnosis && !coverage && !evidence && !rationale) return null;
  return (
    <div className="resume-diagnostics-bar">
      {diagnosis ? (
        <DiagnosticsEntry
          label={t("resume.diagnostics.entry.diagnosis")}
          ariaLabel={t("resume.diagnostics.aria.diagnosis", {
            label: diagnosis.badge ?? "",
          })}
          badge={diagnosis.badge}
          attention={diagnosis.attention}
        >
          {diagnosis.content}
        </DiagnosticsEntry>
      ) : null}
      {coverage ? (
        <DiagnosticsEntry
          label={t("resume.diagnostics.entry.coverage")}
          ariaLabel={t("resume.diagnostics.aria.coverage", { count: coverage.count })}
          badge={String(coverage.count)}
        >
          {coverage.content}
        </DiagnosticsEntry>
      ) : null}
      {evidence ? (
        <DiagnosticsEntry
          label={t("resume.diagnostics.entry.evidence")}
          ariaLabel={t("resume.diagnostics.aria.evidence", { count: evidence.count })}
          badge={String(evidence.count)}
        >
          {evidence.content}
        </DiagnosticsEntry>
      ) : null}
      {rationale ? (
        <DiagnosticsEntry
          label={t("resume.diagnostics.entry.rationale")}
          ariaLabel={t("resume.diagnostics.aria.rationale")}
        >
          {rationale}
        </DiagnosticsEntry>
      ) : null}
    </div>
  );
}
