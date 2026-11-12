// SPDX-License-Identifier: Apache-2.0
/**
 * #17b：「用当前简历覆盖此变体」——被译文污染的源语言变体的修复动作。
 *
 * 背景：#17a 修复前，在中文版上生成翻译并采纳会把英文写回中文版。修复后入口已禁用，
 * 但已污染的变体还在库里；本动作把变体正文恢复为当前简历（名称/语言标签/排版不动），
 * 修复后再重新生成翻译。二次确认必须有：覆盖会丢掉该变体当前的全部改动。
 */
import { Button, Popconfirm, Tooltip } from "antd";
import { useState } from "react";
import { useI18n } from "../../../i18n/i18nContext";
import { overwriteVariant } from "./api";
import type { VariantDetailOut } from "./api";
import { bt } from "./i18n";
import { useToast } from "../../../hooks/useToast";

interface Props {
  resumeId: number;
  variantId: number;
  disabled?: boolean;
  /** 覆盖成功后把新详情交回宿主（刷新变体列表与对照视图）。 */
  onOverwritten: (next: VariantDetailOut) => void;
}

/** 覆盖失败给原因，不假装成功（与双语面板同一错误口径）。 */
function errorTextOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "";
}

export default function VariantOverwriteButton({
  resumeId,
  variantId,
  disabled = false,
  onOverwritten,
}: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const overwrite = async () => {
    setBusy(true);
    try {
      const next = await overwriteVariant(resumeId, variantId);
      toast.success(bt("bilingual.workspace.overwrite.done"));
      onOverwritten(next);
    } catch (caught) {
      toast.error(errorTextOf(caught) || bt("bilingual.workspace.overwrite.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tooltip title={bt("bilingual.workspace.overwrite.hint")}>
      <Popconfirm
        title={bt("bilingual.workspace.overwrite.confirmTitle")}
        description={bt("bilingual.workspace.overwrite.confirmDescription")}
        okText={bt("bilingual.workspace.overwrite.confirmOk")}
        cancelText={t("common.action.cancel")}
        onConfirm={() => void overwrite()}
      >
        <Button type="text" size="small" disabled={disabled || busy || undefined} loading={busy}>
          {bt("bilingual.workspace.overwrite.label")}
        </Button>
      </Popconfirm>
    </Tooltip>
  );
}
