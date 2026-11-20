// SPDX-License-Identifier: Apache-2.0
/**
 * 「行内格式」一行末尾的预览开关（T01）。
 *
 * 它是**全局设置**（`editor_inline_format_preview`），不是单条 item 的属性——所以放在每个
 * 条目编辑器里读同一个模块级 store（`useSyncExternalStore`），状态永远一致，也不会每处
 * 各发一次请求。
 *
 * 为什么 ⓘ 用 `<span role="img">` 而不是 button：这行在 `document-field-row` 里，
 * 外层不是 `<label>`，但仍避免在设置行里塞可聚焦的第二个交互元素——点开关是唯一动作。
 */
import { InfoCircleOutlined } from "@ant-design/icons";
import { App, Switch, Tooltip } from "antd";
import { useState, useSyncExternalStore } from "react";

import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import {
  isInlineFormatPreviewEnabled,
  setInlineFormatPreview,
  subscribeInlineFormatPreview,
} from "./inlineFormatPreviewStore";

export default function InlineFormatPreviewSwitch() {
  useLocale();
  const { message } = App.useApp();
  const enabled = useSyncExternalStore(
    subscribeInlineFormatPreview,
    isInlineFormatPreviewEnabled,
    isInlineFormatPreviewEnabled,
  );
  const [saving, setSaving] = useState(false);

  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      await setInlineFormatPreview(next);
    } catch {
      // store 已经把状态回滚；这里只负责说清楚"没存上"，不假装成功。
      message.error(t("document.inlineFormat.previewSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="document-inline-preview-switch">
      <span className="document-inline-preview-switch__label">
        {t("document.inlineFormat.preview")}
      </span>
      <Tooltip title={t("document.inlineFormat.previewHint")}>
        <span className="document-inline-preview-switch__hint" role="img">
          <InfoCircleOutlined aria-hidden="true" />
        </span>
      </Tooltip>
      <Switch
        size="small"
        checked={enabled}
        loading={saving}
        aria-label={t("document.inlineFormat.preview")}
        onChange={(next) => void toggle(next)}
      />
    </span>
  );
}
