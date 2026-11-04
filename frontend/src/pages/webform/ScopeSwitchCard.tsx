// SPDX-License-Identifier: Apache-2.0
/**
 * Data-range switch for the web-form page: "current plan only" vs "all data".
 *
 * Same semantics as the segmented switch at the top of the picker inside the controlled
 * browser panel, and it goes through the same backend range holder — the picker list, the
 * batch preview and the floating-ball autofill must never read different ranges.
 *
 * Kept as its own card so the page stays an orchestration layer; the copy lives in the
 * `webFormPage.scope.*` namespace of the message packs.
 */
import { Card, Segmented, Space, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { WebFormScope } from "../../types";
import { normalizeWebFormScope } from "../../features/webform/webFormScopeStorage";

export function ScopeSwitchCard({
  scope,
  disabled = false,
  onChange,
}: {
  scope: WebFormScope;
  disabled?: boolean;
  onChange: (scope: WebFormScope) => void;
}) {
  // 订阅语言变化：本组件用模块级 `t()` 取文案，不订阅就会在切语言后停在旧文案。
  useLocale();
  return (
    <Card size="small" title={t("webFormPage.scope.title")}>
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        <Segmented
          block
          aria-label={t("webFormPage.scope.title")}
          disabled={disabled}
          value={scope}
          options={[
            { value: "group", label: t("webFormPage.scope.group") },
            { value: "all", label: t("webFormPage.scope.all") },
          ]}
          onChange={(value) => onChange(normalizeWebFormScope(value))}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("webFormPage.scope.hint")}
        </Typography.Text>
      </Space>
    </Card>
  );
}
