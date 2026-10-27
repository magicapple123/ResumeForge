// SPDX-License-Identifier: Apache-2.0
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { APP_NAME_KEY } from "../../config";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { navigationPageLabelKey } from "./navigationConfig";

/** Keep route changes discoverable without taking focus away from active controls. */
export default function RouteAccessibility() {
  useLocale();
  const { pathname } = useLocation();
  const pageName = t(navigationPageLabelKey(pathname));
  const appName = t(APP_NAME_KEY);

  useEffect(() => {
    document.title = `${pageName} · ${appName}`;
  }, [pageName, appName]);

  return (
    <>
      <a
        className="app-skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        {t("navigation.a11y.skipToMain")}
      </a>
      <span className="rf-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {pageName}
      </span>
    </>
  );
}
