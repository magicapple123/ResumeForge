// SPDX-License-Identifier: Apache-2.0
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { APP_NAME } from "../../config";
import { navigationPageLabel } from "./navigationConfig";

/** Keep route changes discoverable without taking focus away from active controls. */
export default function RouteAccessibility() {
  const { pathname } = useLocation();
  const pageName = navigationPageLabel(pathname);

  useEffect(() => {
    document.title = `${pageName} · ${APP_NAME}`;
  }, [pageName]);

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
        跳到主要内容
      </a>
      <span className="rf-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {pageName}
      </span>
    </>
  );
}
