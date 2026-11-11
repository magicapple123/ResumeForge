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
 *
 * ## `compact` 变体（#24 24A，2026-11-11）
 *
 * 制作台左栏「版面」组顶部要一条**常驻状态条**（一行：`占用 426% · 需要 5 页 / 上限 1 页 ·
 * 超出 4 页`），点开是**同一个** `ResumeLayoutDiagnosisCard`。之所以在这里加变体而不是在
 * 制作台另写一条，就是为了 #24 的一致性约束 1：文案键、阈值、琥珀语义只有一份实现。
 * 变体只改**布局形状**（标签 + 徽标两段 → 一整句），不引入任何新判据：
 * - 显示的那句话由调用方从 `layoutStatusSummary` 取（与预览卡同一个公式与 key）；
 * - `dirty` 只加一颗「未保存」标签，表示"这些数字是按未保存的草稿量的"。
 *
 * 没有可展开内容时（还没量到版面）compact 退化成**不可点的纯状态行**——摆一颗点了没反应
 * 的按钮比不摆更糟。
 */
import { Button, Popover, Tag, Tooltip } from "antd";
import type { ReactNode } from "react";
import { useState } from "react";
import { useI18n } from "../../i18n/i18nContext";

/** 版面诊断入口：内容 + 徽标文字（"偏空 · 占用 81%"）+ 是否需要琥珀提示。 */
export interface DiagnosisEntry {
  /** 弹层正文。`compact` 变体可以只给 `lazyContent`。 */
  content?: ReactNode;
  /**
   * 打开时才构造弹层正文（`compact` 变体用）：`open === false` 时返回 `null`。
   *
   * 存在的唯一理由是**别在关着的时候还挂着请求方**：制作台的诊断卡一挂载就会问一次
   * `/layout/analyze`，而拖动滑杆会让它一路重挂——关掉即卸载才保证"拖动时零请求"。
   */
  lazyContent?: (open: boolean) => ReactNode;
  /** 状态摘要；还没算出来时为 null（只显示入口名）。 */
  badge?: string | null;
  /** 偏空 / 拥挤 / 溢出 = true；健康 = false。 */
  attention?: boolean;
  /**
   * `compact` 变体里那一整句（`占用 426% · 需要 5 页 / 上限 1 页 · 超出 4 页`）。
   * 与 `badge` 同源：由 `layoutStatusSummary` 一次算出来，不在这里拼。
   */
  summary?: string | null;
  /**
   * 「未保存」标记：制作台里的数字按**未保存的草稿**量的，与预览卡（已保存）可能不同。
   * 不标出来，两边数字不一致就会被当成 bug 报上来（#24 一致性约束 2）。
   */
  dirty?: boolean;
}

interface Props {
  diagnosis?: DiagnosisEntry | null;
  /** 未收录资料：正文是 `ResumeCoverageNotesBody` 的渲染结果，`count` 用于徽标与读屏名。 */
  coverage?: { content: ReactNode; count: number } | null;
  /** 内容来源说明：正文是 `EvidencePanel`（embedded），`count` 是标注条数。 */
  evidence?: { content: ReactNode; count: number } | null;
  /** 生成说明：正文是 `RationaleParagraphs`。 */
  rationale?: ReactNode | null;
  /**
   * 形状：`full`（详情预览，默认）= 四个入口并排；`compact`（制作台左栏）= 一整句状态。
   * 两种形状共用同一批 key 与同一条琥珀判据。
   */
  variant?: "full" | "compact";
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

/**
 * `compact` 形状：一整句状态（+ 未保存标签），点开是同一个诊断卡弹层。
 *
 * 三种形态：
 * 1. 有内容 + 有测量 → 可点的按钮（唯一入口）；
 * 2. 还没量到（`content` 为空）→ **不可点**的状态行，只把"正在测量"说出来；
 * 3. 完全没有诊断入口 → 整条不渲染（与 full 变体的口径一致，不留空盒子）。
 */
function CompactDiagnosis({ entry }: { entry?: DiagnosisEntry | null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (!entry) return null;
  const text = entry.summary ?? entry.badge ?? t("resume.diagnostics.entry.diagnosis");
  const dot = entry.attention ? <span className="resume-diagnostics-dot" aria-hidden /> : null;
  const unsaved = entry.dirty ? (
    <Tooltip title={t("workbench.layoutStatus.dirtyHint")}>
      <Tag className="resume-diagnostics-dirty" style={{ marginInlineEnd: 0 }}>
        {t("workbench.layoutStatus.unsaved")}
      </Tag>
    </Tooltip>
  ) : null;
  const content = entry.lazyContent ? entry.lazyContent(open) : entry.content;
  // 有没有东西可展开：懒加载的入口即使还没构造出正文也是可点的（点开才有请求）。
  const expandable = entry.lazyContent !== undefined || Boolean(entry.content);
  if (!expandable) {
    return (
      <div className="resume-diagnostics-bar is-compact">
        {dot}
        <span className="resume-diagnostics-summary">{text}</span>
        {unsaved}
      </div>
    );
  }
  return (
    <div className="resume-diagnostics-bar is-compact">
      <Popover
        trigger="click"
        placement="bottomLeft"
        open={open}
        onOpenChange={setOpen}
        // 与 full 变体同一个弹层容器类：限高 + 内部滚动，不另造一套。
        content={<div className="resume-diagnostics-popover">{content}</div>}
      >
        <Button
          type="text"
          size="small"
          className="resume-diagnostics-entry"
          // 读屏名与预览卡**同一条 key**：状态句本身已经含数字与结论。
          aria-label={t("resume.diagnostics.aria.diagnosis", { label: text })}
        >
          {dot}
          <span className="resume-diagnostics-summary">{text}</span>
          {unsaved}
        </Button>
      </Popover>
    </div>
  );
}

export default function ResumeDiagnosticsBar({
  diagnosis,
  coverage,
  evidence,
  rationale,
  variant = "full",
}: Props) {
  const { t } = useI18n();
  if (variant === "compact") return <CompactDiagnosis entry={diagnosis} />;
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
