// SPDX-License-Identifier: Apache-2.0
import { FormOutlined } from "@ant-design/icons";
import { Switch, Tooltip } from "antd";
import { useMemo, useState } from "react";
import type { WebFormBrowserTarget } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  targets: WebFormBrowserTarget[];
  onToggle: (target: WebFormBrowserTarget, enabled: boolean) => void;
}

export default function WebFormTargetFloatingBalls({ targets, onToggle }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const [open, setOpen] = useState(false);
  const visibleTargets = useMemo(() => targets.slice(0, 8), [targets]);
  const hiddenCount = Math.max(0, targets.length - visibleTargets.length);
  return (
    <div
      className="webform-target-floating-balls"
      role="group"
      aria-label={t("webFormPage.floating.groupAria")}
    >
      <button
        type="button"
        className="webform-target-floating-toggle"
        aria-expanded={open}
        aria-label={
          open ? t("webFormPage.floating.collapseAria") : t("webFormPage.floating.expandAria")
        }
        onClick={() => setOpen((value) => !value)}
      >
        <FormOutlined />
        <span>{targets.length}</span>
      </button>
      {open ? (
        <>
          {visibleTargets.map((target, index) => {
            const pageName =
              target.title ||
              target.url ||
              t("webFormPage.floating.targetFallback", { index: index + 1 });
            return (
              <Tooltip key={target.target_id} title={pageName}>
                <div
                  className={`webform-target-floating-ball ${target.live_enabled ? "is-on" : "is-off"}`}
                >
                  <span className="webform-target-floating-label">
                    {target.title || t("webFormPage.floating.labelFallback", { index: index + 1 })}
                  </span>
                  <Switch
                    checked={target.live_enabled}
                    checkedChildren={<FormOutlined />}
                    unCheckedChildren={t("webFormPage.floating.switchOff")}
                    onChange={(checked) => onToggle(target, checked)}
                    aria-label={t("webFormPage.floating.toggleAria", { name: pageName })}
                  />
                </div>
              </Tooltip>
            );
          })}
          {hiddenCount > 0 ? (
            <span className="webform-target-floating-more">
              {t("webFormPage.floating.more", { count: hiddenCount })}
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
