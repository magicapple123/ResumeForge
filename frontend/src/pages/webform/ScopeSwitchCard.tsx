// SPDX-License-Identifier: Apache-2.0
/**
 * Data-range switch for the web-form page: "current plan only" vs "all data".
 *
 * Same semantics as the segmented switch at the top of the picker inside the controlled
 * browser panel, and it goes through the same backend range holder — the picker list, the
 * batch preview and the floating-ball autofill must never read different ranges.
 *
 * Rendered as one row of `FillModePanel` (I-11): the page stays an orchestration layer and
 * the four fill-mode controls share one panel, so there is no card shell here. The copy
 * lives in the `webFormPage.scope.*` namespace of the message packs.
 */
import { Segmented } from "antd";
import HintDetail from "../../components/common/HintDetail";
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
    <div className="webform-mode-row">
      <span className="webform-mode-label">{t("webFormPage.scope.title")}</span>
      <div className="webform-mode-control">
        <Segmented
          aria-label={t("webFormPage.scope.title")}
          disabled={disabled}
          value={scope}
          options={[
            { value: "group", label: t("webFormPage.scope.group") },
            { value: "all", label: t("webFormPage.scope.all") },
          ]}
          onChange={(value) => onChange(normalizeWebFormScope(value))}
        />
        {/* 55 字的范围解释常驻会把行高从 40 拉到 76；它只在第一次切换前值得读一遍，
            所以收进 ⓘ，标签与控件留在同一行。 */}
        <HintDetail
          className="webform-mode-info"
          detail={t("webFormPage.scope.hint")}
          label={t("webFormPage.scope.hintAria")}
        />
      </div>
    </div>
  );
}
