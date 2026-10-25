// SPDX-License-Identifier: Apache-2.0
/** 资料库/组写操作失败的用户提示（F6）：错误码 → 具体修复动作，禁止"操作失败"兜底。 */
import { ApiError } from "../../api/client";
import { t } from "../../i18n";

/** 把后端 StoreError（{detail, code, ...}）映射成一句人话；未知错误保留原 message。 */
export function profileErrorMessage(err: unknown, fallback?: string): string {
  if (err instanceof ApiError) {
    switch (err.businessCode) {
      case "revision_conflict":
        return t("profileLibrary.error.conflict");
      case "limit_reached":
        return t("profileLibrary.error.limit");
      case "builtin_protected":
        return t("profileLibrary.error.builtinProtected");
      case "field_has_values":
        return t("profileLibrary.error.fieldHasValues");
      case "default_group_protected":
        return t("profileLibrary.error.defaultGroup");
      case "not_found":
        return t("profileLibrary.error.notFound");
      default:
        break;
    }
    if (err.message) return err.message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback ?? t("profileLibrary.error.unknown");
}
