// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台「历史」页签（W03）：已发生 / 可恢复两组步骤，点一步**预览**它当时的摘要。
 *
 * 为什么是左栏页签而不是弹窗：撤销/恢复要和「排版参数 / 文档大纲」并列——用户在这里改坏
 * 了东西，视线本来就落在左栏；弹出第二层容器既违反叠层守卫，也让人找不到。
 *
 * 组件本身**不持有历史**：`past/future` 由宿主的 `useResumeDocument` 给出（唯一状态源），
 * 这里只负责把"第几步、叫什么、当时长什么样"画出来。点步骤只切换预览，**不改文档**——
 * 真正的回退由「撤销」按钮执行，避免"点一下就跳到那一步"这种不可逆的误操作。
 */
import { Button } from "antd";
import { useState } from "react";
import EmptyState from "../../common/EmptyState";
import { t } from "../../../i18n";

export interface HistoryPanelStep {
  /** 给用户看的动作名（"编辑正文" / "调整排版" / "结构操作"）。 */
  label: string;
  /** 当时的可读摘要（姓名 · 条目数 · 页数）。 */
  summary: string;
}

interface Props {
  /** 已发生的步骤：最旧 → 最新。 */
  past: HistoryPanelStep[];
  /** 可恢复的步骤：末尾是下一次「恢复」会到达的那一步。 */
  future: HistoryPanelStep[];
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  className?: string;
}

type PreviewTarget = { group: "past" | "future"; index: number } | null;

export default function HistoryPanel({
  past,
  future,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  className,
}: Props) {
  const [preview, setPreview] = useState<PreviewTarget>(null);
  const pastSteps = [...past].reverse();
  const futureSteps = [...future];
  const previewed =
    preview === null
      ? null
      : preview.group === "past"
        ? past[preview.index]
        : future[preview.index];

  const toggle = (group: "past" | "future", index: number) => {
    setPreview((current) =>
      current?.group === group && current.index === index ? null : { group, index },
    );
  };

  return (
    <div
      className={className}
      style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        <Button size="small" onClick={onUndo} disabled={!canUndo || undefined}>
          {t("workbench.history.undo")}
        </Button>
        <Button size="small" onClick={onRedo} disabled={!canRedo || undefined}>
          {t("workbench.history.redo")}
        </Button>
      </div>
      {past.length === 0 && future.length === 0 ? (
        <EmptyState inline description={t("workbench.history.empty")} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--rf-text-secondary)" }}>
            {t("workbench.history.preview.hint")}
          </span>
          {pastSteps.length > 0 ? (
            <StepGroup
              title={t("workbench.history.past")}
              steps={pastSteps}
              group="past"
              active={preview}
              onToggle={toggle}
            />
          ) : null}
          {futureSteps.length > 0 ? (
            <StepGroup
              title={t("workbench.history.future")}
              steps={futureSteps}
              group="future"
              active={preview}
              onToggle={toggle}
            />
          ) : null}
          {previewed ? (
            <div
              role="status"
              style={{
                padding: "6px 8px",
                borderRadius: 6,
                background: "var(--rf-surface-alt, var(--rf-surface))",
                border: "1px solid var(--rf-border-subtle)",
                fontSize: 12,
              }}
            >
              <strong>{previewed.label}</strong>
              <span style={{ color: "var(--rf-text-secondary)" }}> · {previewed.summary}</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function StepGroup({
  title,
  steps,
  group,
  active,
  onToggle,
}: {
  title: string;
  steps: HistoryPanelStep[];
  group: "past" | "future";
  active: PreviewTarget;
  onToggle: (group: "past" | "future", index: number) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{title}</span>
      {steps.map((step, index) => {
        // past 在界面上是倒序展示的：显示下标要换算回数据下标，预览才点得对。
        const dataIndex = group === "past" ? steps.length - 1 - index : index;
        const selected = active?.group === group && active.index === dataIndex;
        return (
          <button
            key={`${group}-${dataIndex}`}
            type="button"
            aria-pressed={selected}
            onClick={() => onToggle(group, dataIndex)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 2,
              padding: "4px 8px",
              borderRadius: 6,
              border: `1px solid ${selected ? "var(--rf-primary)" : "var(--rf-border-subtle)"}`,
              background: "transparent",
              color: "inherit",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 12 }}>{step.label}</span>
            <span style={{ fontSize: 12, color: "var(--rf-text-secondary)" }}>{step.summary}</span>
          </button>
        );
      })}
    </div>
  );
}
