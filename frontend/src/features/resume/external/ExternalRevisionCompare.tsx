// SPDX-License-Identifier: Apache-2.0
/**
 * 历史版本「原版 / 新版对比」（T12）：左边是**选中的那一版**，右边是**当前版本**。
 *
 * ## 为什么右列固定是"当前版本"
 *
 * 用户点「对比」时问的是同一句话："我如果恢复这一版，会丢掉什么？"——参照物只能是
 * 现在生效的那一版。拿"上一条版本"当参照会让答案随列表位置变化，读起来更费劲
 * （逐版字数差已经由列表行的 `比上一版 ±N 字` 回答）。
 *
 * ## 正文从哪来
 *
 * 历史版本表只存 `text_chars`，不存正文（同一段话存 N 遍没意义），所以这里在展开时
 * 按需拉一次 `GET /{id}/revisions/{rid}/text`。当前版本的正文来自 `record.text`。
 *
 * ## 太长就不逐行比
 *
 * 见 `revisionDiff.ts`：单侧超过 `MAX_DIFF_LINES` 行时不算 DP，直接如实说明"跳过逐行
 * 对比"。宁可少给一张表，也不要给一张被悄悄截断的表——后者看起来像"中间真的没了"。
 */
import { Alert, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { getExternalResumeRevisionText } from "../../../api/externalResumes";
import type { ExternalResumeRevision } from "../../../api/externalResumes";
import LoadingBlock from "../../../components/common/LoadingBlock";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { formatDateTime } from "../../../utils/format";
import { diffSummary, isDiffable, lineDiff, MAX_DIFF_LINES } from "./revisionDiff";
import type { DiffRow } from "./revisionDiff";
import "./externalPreview.css";
import "./externalRevisionDiff.css";

export interface ExternalRevisionCompareProps {
  resumeId: number;
  /** 被对比的那一版（列表里点「对比」的那一行）。 */
  revision: ExternalResumeRevision;
  /** 当前版本的正文（`record.text`）：右列。 */
  currentText: string;
}

/** 一列：行号 + 文字。没有这一行时留一条等高的空位，两列才对得齐。 */
function DiffCell({ line, text }: { line: number | null; text: string | null }) {
  if (text === null) return <div className="rf-ext-diff-cell is-empty" aria-hidden="true" />;
  return (
    <div className="rf-ext-diff-cell">
      <span className="rf-ext-diff-line-no">{line ?? ""}</span>
      <span className="rf-ext-diff-text">{text.length > 0 ? text : "\u00a0"}</span>
    </div>
  );
}

/** 一条差异行：左右两格，底色由 `kind` 决定。 */
function DiffLine({ row }: { row: DiffRow }) {
  return (
    <div className={`rf-ext-diff-row is-${row.kind}`} data-testid={`external-diff-${row.kind}`}>
      <DiffCell line={row.leftLine} text={row.left} />
      <DiffCell line={row.rightLine} text={row.right} />
    </div>
  );
}

export function ExternalRevisionCompare({
  resumeId,
  revision,
  currentText,
}: ExternalRevisionCompareProps) {
  useLocale();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError("");
    void getExternalResumeRevisionText(resumeId, revision.id)
      .then((next) => {
        if (!cancelled) setText(next.text);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setText("");
        setError(caught instanceof Error ? caught.message : t("externalEdit.compare.failed"));
      });
    return () => {
      cancelled = true;
    };
  }, [resumeId, revision.id]);

  const diffable = text !== null && isDiffable(text, currentText);
  const rows = diffable ? lineDiff(text, currentText) : [];
  const summary = diffSummary(rows);

  return (
    <div className="rf-ext-compare" data-testid={`external-compare-pane-${revision.id}`}>
      <div className="rf-ext-compare-head">
        <Space size={8} wrap>
          <Typography.Text strong>{t("externalEdit.revisions.compare")}</Typography.Text>
          <Tag>{formatDateTime(revision.created_at)}</Tag>
          {diffable ? (
            <>
              <Tag color="green">{t("externalEdit.compare.added", { count: summary.added })}</Tag>
              <Tag color="red">{t("externalEdit.compare.removed", { count: summary.removed })}</Tag>
            </>
          ) : null}
        </Space>
        {/* 按钮在**上一行**的行内操作里（同一条版本行的「恢复此版本」），这里只说明后果。 */}
        <Typography.Text type="secondary" className="rf-ext-compare-hint">
          {t("externalEdit.compare.restoreHint")}
        </Typography.Text>
      </div>
      {error ? (
        <Alert type="error" showIcon title={t("externalEdit.compare.failed")} description={error} />
      ) : text === null ? (
        <LoadingBlock tip={t("externalEdit.compare.loading")} />
      ) : text.trim().length === 0 ? (
        <Alert type="info" showIcon title={t("externalEdit.compare.noText")} />
      ) : !diffable ? (
        <Alert
          type="info"
          showIcon
          title={t("externalEdit.compare.tooLarge", { limit: MAX_DIFF_LINES })}
        />
      ) : summary.added === 0 && summary.removed === 0 ? (
        <Alert type="success" showIcon title={t("externalEdit.compare.same")} />
      ) : (
        <div className="rf-ext-diff" data-testid={`external-diff-${revision.id}`}>
          <div className="rf-ext-diff-head">
            <Typography.Text type="secondary">
              {t("externalEdit.compare.left", { time: formatDateTime(revision.created_at) })}
            </Typography.Text>
            <Typography.Text type="secondary">{t("externalEdit.compare.right")}</Typography.Text>
          </div>
          {rows.map((row, index) => (
            <DiffLine
              key={`${row.kind}-${row.leftLine ?? "a"}-${row.rightLine ?? "b"}-${index}`}
              row={row}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default ExternalRevisionCompare;
