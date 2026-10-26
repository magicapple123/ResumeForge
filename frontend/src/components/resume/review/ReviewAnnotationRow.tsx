// SPDX-License-Identifier: Apache-2.0
/**
 * 一条批注的展示与操作（W18 / 契约 §4.3 状态机）。
 *
 * 状态对应的可用动作（不允许多、也不允许少）：
 * | 状态 | 动作 |
 * |---|---|
 * | open | 标记已解决 / 忽略这条 |
 * | resolved | 重新打开 |
 * | stale | 重新关联（用户显式选当前对象）/ 忽略这条 |
 * | dismissed | （无动作，记录保留） |
 *
 * 「定位」只在当前内容里能解析到路径时出现；解析不到时明确写"无法定位"，不提供灰色按钮
 * 让用户猜（更不会按下标挂到别的对象）。
 */
import { Button, Select, Space, Tag } from "antd";
import { t } from "../../../i18n";
import type { ReviewAnnotationRecord, ReviewResolution } from "../../../features/resume-review";
import { STATUS_LABEL_KEY } from "./reviewLabels";
import { useLocale } from "../../../i18n/i18nContext";

export interface ReattachOption {
  value: string;
  label: string;
}

export interface ReviewAnnotationRowProps {
  annotation: ReviewAnnotationRecord;
  resolution: ReviewResolution;
  readOnly: boolean;
  busy: boolean;
  /** 这条的"重新关联"选择器是否展开。 */
  reattaching: boolean;
  reattachOptions: readonly ReattachOption[];
  onLocate?: () => void;
  onResolve: () => void;
  onReopen: () => void;
  onDismiss: () => void;
  onStartReattach: () => void;
  onCancelReattach: () => void;
  onPickReattach: (value: string) => void;
}

/** 时间的可读截断：ISO 串只显示到分钟（完整值放 title，用于截断文本提示）。 */
function shortTime(value: string): string {
  if (!value) return "";
  return value
    .replace("T", " ")
    .replace(/\.\d+Z?$/, "")
    .replace(/Z$/, "")
    .slice(0, 16);
}

export default function ReviewAnnotationRow({
  annotation,
  resolution,
  readOnly,
  busy,
  reattaching,
  reattachOptions,
  onLocate,
  onResolve,
  onReopen,
  onDismiss,
  onStartReattach,
  onCancelReattach,
  onPickReattach,
}: ReviewAnnotationRowProps) {
  useLocale();
  const status = annotation.status;
  const canLocate = Boolean(resolution.path && onLocate);
  return (
    <li className={`resume-review-row is-${status}`} data-status={status}>
      <div className="resume-review-row-head">
        <Tag
          className={`resume-review-status is-${status}`}
          aria-label={t("review.annotation.statusLabel")}
        >
          {t(STATUS_LABEL_KEY[status])}
        </Tag>
        {annotation.reviewer ? (
          <span className="resume-review-meta">
            {t("review.annotation.reviewer", { name: annotation.reviewer })}
          </span>
        ) : null}
        <span className="resume-review-meta" title={annotation.created_at}>
          {shortTime(annotation.created_at)}
        </span>
      </div>
      <p className="resume-review-body">{annotation.text}</p>
      {annotation.quoted_text ? (
        <p className="resume-review-quote">
          {t("review.annotation.quote", { text: annotation.quoted_text })}
        </p>
      ) : null}
      <div className="resume-review-target">
        {resolution.path ? (
          <>
            <span className="resume-review-meta">
              {t("review.annotation.target", { name: resolution.objectLabel ?? resolution.path })}
            </span>
            {resolution.via === "path" ? (
              <span className="resume-review-meta">{t("review.annotation.legacyAnchor")}</span>
            ) : null}
            {canLocate ? (
              <Button type="link" size="small" onClick={onLocate}>
                {t("review.action.locate")}
              </Button>
            ) : null}
          </>
        ) : (
          <span className="resume-review-meta">{t("review.annotation.unlocatable")}</span>
        )}
      </div>
      {status === "stale" ? (
        <p className="resume-review-hint">{t("review.status.staleHint")}</p>
      ) : null}
      {status === "dismissed" ? (
        <p className="resume-review-hint">{t("review.status.dismissedHint")}</p>
      ) : null}
      {reattaching ? (
        <Space wrap>
          <Select
            style={{ minWidth: 240 }}
            aria-label={t("review.reattach.title")}
            placeholder={t("review.reattach.hint")}
            options={reattachOptions.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            showSearch
            optionFilterProp="label"
            onChange={(value: string) => onPickReattach(value)}
          />
          <Button size="small" onClick={onCancelReattach}>
            {t("common.action.cancel")}
          </Button>
        </Space>
      ) : null}
      {readOnly ? null : (
        <Space wrap>
          {status === "open" ? (
            <>
              <Button size="small" loading={busy} onClick={onResolve}>
                {t("review.action.resolve")}
              </Button>
              <Button size="small" type="text" loading={busy} onClick={onDismiss}>
                {t("review.action.dismiss")}
              </Button>
            </>
          ) : null}
          {status === "resolved" ? (
            <Button size="small" loading={busy} onClick={onReopen}>
              {t("review.action.reopen")}
            </Button>
          ) : null}
          {status === "stale" ? (
            <>
              <Button size="small" loading={busy} onClick={onStartReattach}>
                {t("review.action.reattach")}
              </Button>
              <Button size="small" type="text" loading={busy} onClick={onDismiss}>
                {t("review.action.dismiss")}
              </Button>
            </>
          ) : null}
        </Space>
      )}
    </li>
  );
}
