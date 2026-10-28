// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台「历史」页签（W03）：已发生 / 可恢复两组步骤，每步显示**时间**，点一步预览它当时的
 * 摘要，预览条上给「回到这一步 / 回到当前」。
 *
 * 为什么是左栏页签而不是弹窗：撤销/恢复要和「排版参数 / 文档大纲」并列——用户在这里改坏
 * 了东西，视线本来就落在左栏；弹出第二层容器既违反叠层守卫，也让人找不到。
 *
 * 组件本身**不持有历史**：`past/future` 由宿主的 `useResumeDocument` 给出（唯一状态源），
 * 这里只负责把"第几步、叫什么、几点、当时长什么样"画出来。点步骤只切换预览，**不改文档**；
 * 真正的回退要用户在预览条上再点一次「回到这一步」并确认——避免"点一下就跳到那一步"这种
 * 不可逆的误操作（2026-10-29 用户要求"增加一个回到当前选中历史的按钮"，就是这个动作）。
 *
 * 2026-10-25（任务 C3）：去掉内联样式与裸 `<button>`，步骤行改用 antd Button
 * （type=text + block，保留 aria-pressed 与两条文字层级），样式集中在 history.css。
 * 2026-10-29：每步右侧加时间（`formatStepTime`），撤销/恢复换成带图标的等宽按钮，
 * 预览条成为"回退到此步"的操作区。
 */
import { RedoOutlined, UndoOutlined } from "@ant-design/icons";
import { Button, Popconfirm, Tooltip } from "antd";
import { useState } from "react";
import EmptyState from "../../common/EmptyState";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { formatStepTime } from "./formatStepTime";
import "./history.css";

export interface HistoryPanelStep {
  /** 给用户看的动作名（"编辑正文" / "调整排版" / "结构操作"）。 */
  label: string;
  /** 当时的可读摘要（姓名 · 条目数 · 页数）。 */
  summary: string;
  /** 这一步发生的时间（毫秒时间戳）；缺省/非法时不显示时间，不让一行变歪。 */
  at?: number;
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
  /** 真正回退到某一步（宿主连续 undo/redo 实现）；不传 = 只给「回到当前」。 */
  onJumpTo?: (group: "past" | "future", index: number) => void;
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
  onJumpTo,
  className,
}: Props) {
  useLocale();
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

  /** 回退并在成功后取消选中：留在"已回退到的那一步"的预览上会误导（那一步已成为当前）。 */
  const jumpTo = () => {
    if (!preview) return;
    onJumpTo?.(preview.group, preview.index);
    setPreview(null);
  };

  return (
    <div className={`resume-history${className ? ` ${className}` : ""}`}>
      <div className="resume-history-actions">
        {/* 禁用态的按钮收不到鼠标事件，Tooltip 要挂在 span 外壳上才显示得出来。 */}
        <Tooltip title={canUndo ? undefined : t("workbench.history.undo.hint")}>
          <span className="resume-history-action-wrap">
            <Button
              size="small"
              className="resume-history-action resume-history-undo"
              icon={<UndoOutlined />}
              onClick={onUndo}
              disabled={!canUndo || undefined}
            >
              {t("workbench.history.undo")}
            </Button>
          </span>
        </Tooltip>
        <Tooltip title={canRedo ? undefined : t("workbench.history.redo.hint")}>
          <span className="resume-history-action-wrap">
            <Button
              size="small"
              className="resume-history-action resume-history-redo"
              icon={<RedoOutlined />}
              onClick={onRedo}
              disabled={!canRedo || undefined}
            >
              {t("workbench.history.redo")}
            </Button>
          </span>
        </Tooltip>
      </div>
      {past.length === 0 && future.length === 0 ? (
        <EmptyState inline description={t("workbench.history.empty")} />
      ) : (
        <div className="resume-history-body">
          <p className="resume-history-hint">{t("workbench.history.preview.hint")}</p>
          {previewed ? (
            // 预览条放在列表**上方**、紧挨说明句：它是"当前选中的快照"，不是列表里的一步；
            // 继续放底部会与刚点的行逐字重复，看起来像多出一行。
            <div className="resume-history-preview">
              <div role="status" className="resume-history-preview-main">
                <span className="resume-history-preview-label">
                  {t("workbench.history.preview.label")}
                </span>
                <strong>{previewed.label}</strong>
                {typeof previewed.at === "number" ? (
                  <span className="resume-history-preview-time">
                    {formatStepTime(previewed.at)}
                  </span>
                ) : null}
                <span className="resume-history-preview-summary"> · {previewed.summary}</span>
              </div>
              <div className="resume-history-preview-actions">
                <Popconfirm
                  title={t("workbench.history.jumpTo.confirm")}
                  okText={t("workbench.history.jumpTo")}
                  cancelText={t("common.action.cancel")}
                  onConfirm={jumpTo}
                  disabled={!onJumpTo}
                >
                  <Button
                    size="small"
                    type="primary"
                    className="resume-history-jump"
                    disabled={!onJumpTo || undefined}
                  >
                    {t("workbench.history.jumpTo")}
                  </Button>
                </Popconfirm>
                <Button
                  size="small"
                  className="resume-history-jump-current"
                  onClick={() => setPreview(null)}
                >
                  {t("workbench.history.backToCurrent")}
                </Button>
              </div>
            </div>
          ) : null}
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
    <div className="resume-history-group">
      <span className="resume-history-group-title">{title}</span>
      {steps.map((step, index) => {
        // past 在界面上是倒序展示的：显示下标要换算回数据下标，预览才点得对。
        const dataIndex = group === "past" ? steps.length - 1 - index : index;
        const selected = active?.group === group && active.index === dataIndex;
        return (
          <Button
            key={`${group}-${dataIndex}`}
            type="text"
            block
            className={`resume-history-step${selected ? " is-selected" : ""}`}
            aria-pressed={selected}
            onClick={() => onToggle(group, dataIndex)}
          >
            <span className="resume-history-step-main">
              <span className="resume-history-step-label">{step.label}</span>
              <span className="resume-history-step-summary">{step.summary}</span>
            </span>
            {typeof step.at === "number" ? (
              <span className="resume-history-step-time">{formatStepTime(step.at)}</span>
            ) : null}
          </Button>
        );
      })}
    </div>
  );
}
