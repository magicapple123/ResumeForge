// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑页的**右栏：原文 → 新文**（R9-5）。
 *
 * 三个状态先说清楚，界面不猜：
 * - 没选中块：只提示"先在左边点一段"。
 * - 选中的块不可编辑：把原因写出来，文本框禁用，**不给**「应用」（点了只会 422）。
 * - 编辑结果里 `overflow` 为真：红框说明"压到下方内容了"，并给一个「下移下方内容 Δpt」
 *   按钮 —— **用户点了才动**（与 Acrobat 的文本框一致）。
 *
 * 「原文」是**灰底只读**的一块：它回答"我改的是哪一句"，比让人回头去左栏找更快。
 * 输入时的「可能超出原块宽度」只是预警（按字号折算每行字数），真正的溢出判定在服务端。
 *
 * `scaled` / `shifted` 是"这次改字顺带发生了什么"，各给一条提示，别让用户以为版式坏了。
 */
import { Alert, Button, Input, Space, Tag, Typography } from "antd";
import { useState } from "react";
import type { ExternalResumeBlock } from "../../../api/externalResumes";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { exceedsBlockWidth, reasonKey, shiftBelowAmount } from "./blockGeometry";

/** 一次改字之后要知道的那点事（由外层从 `ExternalResumeEditResult` 摘出来）。 */
export interface ExternalResumeEditOutcome {
  deltaPt: number;
  overflow: boolean;
  scaled: boolean;
  shifted: boolean;
  linesBefore: number;
  linesAfter: number;
}

export interface ExternalResumeEditorPanelProps {
  /** 当前选中的块；null = 还没点。 */
  block: ExternalResumeBlock | null;
  /** 块在文件里的读法（第 N 页 · 第 M 段），由列表侧算好传进来，避免两处各算一遍。 */
  blockLabel: string;
  submitting: boolean;
  outcome: ExternalResumeEditOutcome | null;
  /** 上一次应用失败的原因（后端句子），空串表示没有错误。 */
  error: string;
  onApply: (text: string) => void;
  /** 传 `shiftBelowAmount(delta)` 的结果。 */
  onShiftBelow: (delta: number) => void;
}

/** 文本框上限与后端 `MAX_EDIT_TEXT_CHARS` 一致：在前端拦一次，省一趟 422。 */
const MAX_TEXT_CHARS = 4000;

function OutcomeAlerts({
  outcome,
  submitting,
  onShiftBelow,
}: {
  outcome: ExternalResumeEditOutcome;
  submitting: boolean;
  onShiftBelow: (delta: number) => void;
}) {
  const delta = shiftBelowAmount(outcome.deltaPt);
  return (
    <Space orientation="vertical" size={8} style={{ width: "100%" }}>
      {outcome.overflow ? (
        <Alert
          data-testid="external-overflow"
          type="error"
          showIcon
          title={t("externalEdit.overflow.title")}
          description={t("externalEdit.overflow.body", {
            delta,
            before: outcome.linesBefore,
            after: outcome.linesAfter,
          })}
          action={
            <Button
              data-testid="external-shift"
              danger
              size="small"
              loading={submitting}
              onClick={() => onShiftBelow(delta)}
            >
              {t("externalEdit.shift.action", { delta })}
            </Button>
          }
        />
      ) : null}
      {outcome.scaled ? (
        <Alert data-testid="external-scaled" type="warning" showIcon title={t("externalEdit.scaled")} />
      ) : null}
      {outcome.shifted ? (
        <Alert data-testid="external-shifted" type="success" showIcon title={t("externalEdit.shifted")} />
      ) : null}
    </Space>
  );
}

export function ExternalResumeEditorPanel({
  block,
  blockLabel,
  submitting,
  outcome,
  error,
  onApply,
  onShiftBelow,
}: ExternalResumeEditorPanelProps) {
  useLocale();
  // 由外层用 `key` 按"块 + 版本"重建本组件，所以这里直接以块原文为初值。
  const [text, setText] = useState<string>(block?.text ?? "");

  if (block === null) {
    return (
      <Alert data-testid="external-panel-empty" type="info" showIcon title={t("externalEdit.hint.pick")} />
    );
  }

  if (!block.editable) {
    return (
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        <Typography.Text strong>{blockLabel}</Typography.Text>
        <Alert
          data-testid="external-panel-blocked"
          type="warning"
          showIcon
          title={t("externalEdit.notEditableTitle")}
          description={t(reasonKey(block.reason))}
        />
        <div className="rf-ext-original" data-testid="external-original-text">
          {block.text}
        </div>
      </Space>
    );
  }

  const changed = text !== block.text;
  const tooWide = changed && exceedsBlockWidth(block, text);
  return (
    // 用**具名** flex 列而不是 `Space`：下面那块灰底「原文」要 `flex: 1` 撑满余下高度
    // （T11 的"原文改 grow"），antd 的 `Space` 会给每个子项套一层匿名 `.ant-space-item`，
    // 拿不到可以拉伸的那一层。
    <div className="rf-ext-form">
      <Space size={8} wrap>
        <Typography.Text strong>{blockLabel}</Typography.Text>
        {block.size > 0 ? (
          <Tag>{t("externalEdit.fontSize", { size: Math.round(block.size * 10) / 10 })}</Tag>
        ) : null}
      </Space>
      <Typography.Text strong>{t("externalEdit.panel.original")}</Typography.Text>
      <div className="rf-ext-original" data-testid="external-original-text">
        {block.text}
      </div>
      <Typography.Text strong>{t("externalEdit.panel.newText")}</Typography.Text>
      <Input.TextArea
        data-testid="external-text-input"
        aria-label={t("externalEdit.textarea.label")}
        value={text}
        autoSize={{ minRows: 5, maxRows: 12 }}
        maxLength={MAX_TEXT_CHARS}
        placeholder={t("externalEdit.textarea.placeholder")}
        onChange={(event) => setText(event.target.value)}
      />
      <Space size={8} wrap>
        <Button
          data-testid="external-apply"
          type="primary"
          disabled={!changed || text.trim().length === 0}
          loading={submitting}
          onClick={() => onApply(text)}
        >
          {t("externalEdit.apply")}
        </Button>
        <Button
          data-testid="external-reset"
          disabled={!changed || submitting}
          onClick={() => setText(block.text)}
        >
          {t("externalEdit.reset")}
        </Button>
        <Typography.Text type="secondary">{t("externalEdit.chars", { count: text.length })}</Typography.Text>
        <Typography.Text type="secondary">
          {t("externalEdit.panel.origChars", { count: block.text.length })}
        </Typography.Text>
      </Space>
      {tooWide ? (
        <Typography.Text type="warning" data-testid="external-too-wide">
          {t("externalEdit.panel.tooWide")}
        </Typography.Text>
      ) : null}
      {changed ? null : (
        <Typography.Text type="secondary">{t("externalEdit.unchanged")}</Typography.Text>
      )}
      {changed && text.trim().length === 0 ? (
        <Typography.Text type="secondary">{t("externalEdit.emptyText")}</Typography.Text>
      ) : null}
      {error ? (
        <Alert
          data-testid="external-apply-error"
          type="error"
          showIcon
          title={t("externalEdit.applyFailed")}
          description={error}
        />
      ) : null}
      {outcome ? <OutcomeAlerts outcome={outcome} submitting={submitting} onShiftBelow={onShiftBelow} /> : null}
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("externalEdit.keepFormatHint")}
      </Typography.Text>
    </div>
  );
}

export default ExternalResumeEditorPanel;
