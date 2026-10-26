// SPDX-License-Identifier: Apache-2.0
import { getSnapshot } from "../../i18n/localeStore";
import type { ResumeLayout } from "../../types";

/** Creation defaults must not change the fallback for existing records. */
export function newResumeLayout(): ResumeLayout {
  return {
    template: "classic",
    format_name: "",
    page_limit: 1,
    font_scale: "standard",
    language: getSnapshot().locale,
  };
}

/** Called only when opening a fresh creation session, never on UI locale changes. */
export function withCreationLanguage(layout: ResumeLayout): ResumeLayout {
  return { ...layout, language: getSnapshot().locale };
}
