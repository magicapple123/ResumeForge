// SPDX-License-Identifier: Apache-2.0
/**
 * 工具卡展开后的明细（#13C 参数 / #13D 写操作 diff + 撤销）。
 *
 * 参数只渲染后端投影过的 args_preview（白名单键带值、值已截 120 字），不直接铺
 * arguments——那会把用户资料原样带进界面与导出。没有公开参数时显示「无公开参数」，
 * 不渲染一张空表。
 *
 * 撤销语义必须说清：它恢复的是**整份简历**到写前留档的命名版本，不是只撤这个字段。
 * 所以二次确认文案显式写「整份简历恢复到版本 X」。只覆盖简历文档类写工具；其他
 * 写工具（profile/claims 等）只提示「该操作暂不支持撤销」。
 */
import { UndoOutlined } from "@ant-design/icons";
import { App, Button, Descriptions, Typography } from "antd";
import { useState } from "react";
import type { AssistantToolCall, AssistantToolWritePreview } from "../../../types";
import { restoreVersion } from "../../resume-versions/versionsApi";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

function ArgsTable({ call }: { call: AssistantToolCall }) {
  const args = call.args_preview ?? [];
  // 没有白名单键（或老消息没有 args_preview）时不渲染空表：空表比一句话更费解。
  if (!args.some((item) => item.value)) {
    return (
      <Typography.Text type="secondary">{t("assistantUi.toolCalls.noPublicArgs")}</Typography.Text>
    );
  }
  return (
    <Descriptions
      size="small"
      column={1}
      className="assistant-tool-call-args"
      items={args.map((item) => ({
        key: item.key,
        label: item.key,
        children: item.value ? (
          // 后端已截到 120 字；title 给出这份截断后的完整值提示（不是原始全文）。
          <span className="assistant-tool-call-arg-value" title={item.value}>
            {item.value}
          </span>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
      }))}
    />
  );
}

type UndoState = "idle" | "running" | "done";

function WriteDiff({ preview }: { preview: AssistantToolWritePreview }) {
  useLocale();
  const { message, modal } = App.useApp();
  const [undoState, setUndoState] = useState<UndoState>("idle");
  const version = preview.version_id;
  const resumeId = preview.resume_id;
  const canUndo = version !== null && resumeId !== null;
  const undoDisabled = !canUndo || undoState === "running";

  const before = preview.before ?? t("assistantUi.toolCalls.diffAdded");
  const after = preview.after ?? t("assistantUi.toolCalls.diffAdded");

  const handleUndo = () => {
    if (version === null || resumeId === null) return;
    modal.confirm({
      title: t("assistantUi.toolCalls.undoConfirmTitle"),
      // 这条文案是本批最容易被误解的一条：必须写明恢复的是整份简历，不是单个字段。
      content: t("assistantUi.toolCalls.undoConfirmContent", { version }),
      okText: t("assistantUi.toolCalls.undoConfirmOk"),
      okButtonProps: { danger: true },
      cancelText: t("common.action.cancel"),
      onOk: async () => {
        setUndoState("running");
        try {
          await restoreVersion(resumeId, version, preview.revision ?? undefined);
          setUndoState("done");
          message.success(t("assistantUi.toolCalls.undoDone"));
        } catch (error) {
          // 失败回滚 UI 状态：卡片回到「可撤销」，让用户可以再试一次。
          setUndoState("idle");
          message.error(
            error instanceof Error ? error.message : t("assistantUi.toolCalls.undoFailed"),
          );
        }
      },
    });
  };

  return (
    <div className="assistant-tool-call-write">
      <div className="assistant-tool-call-diff">
        <span className="assistant-tool-call-diff-label">
          {t("assistantUi.toolCalls.diffBefore")}
        </span>
        <span className="assistant-tool-call-diff-value" title={before}>
          {before}
        </span>
        <span className="assistant-tool-call-diff-arrow" aria-hidden="true">
          →
        </span>
        <span className="assistant-tool-call-diff-label">
          {t("assistantUi.toolCalls.diffAfter")}
        </span>
        <span className="assistant-tool-call-diff-value" title={after}>
          {after}
        </span>
        {undoState === "done" ? (
          <Typography.Text type="success" className="assistant-tool-call-undone">
            {t("assistantUi.toolCalls.undoDone")}
          </Typography.Text>
        ) : (
          <Button
            type="link"
            size="small"
            icon={<UndoOutlined />}
            loading={undoState === "running"}
            disabled={undoDisabled || undefined}
            onClick={handleUndo}
          >
            {t("assistantUi.toolCalls.undo")}
          </Button>
        )}
      </div>
    </div>
  );
}

export default function MessageToolCallDetails({ call }: { call: AssistantToolCall }) {
  useLocale();
  const showUnsupported = !call.preview && call.changed === true;
  return (
    <div className="assistant-tool-call-details">
      <div className="assistant-tool-call-section">
        <Typography.Text strong className="assistant-tool-call-section-title">
          {t("assistantUi.toolCalls.args")}
        </Typography.Text>
        <ArgsTable call={call} />
      </div>
      {call.preview ? (
        <div className="assistant-tool-call-section">
          <WriteDiff preview={call.preview} />
        </div>
      ) : null}
      {showUnsupported ? (
        <Typography.Text type="secondary" className="assistant-tool-call-unsupported">
          {t("assistantUi.toolCalls.undoUnsupported")}
        </Typography.Text>
      ) : null}
    </div>
  );
}
