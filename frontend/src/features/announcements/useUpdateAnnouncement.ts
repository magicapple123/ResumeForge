// SPDX-License-Identifier: Apache-2.0
/**
 * 公告条的第一个真实来源：更新可用 / 更新包已下载。
 *
 * 刻意只接这一类。另外三个 code（`backend.degraded` / `dataset.error`）**留接口不接实现**：
 * 每接一类都要先定义"什么时候清"，没有真实触发点就写死逻辑，只会留下一条永远不消失的公告。
 *
 * 与 `settings/UpdateCard.tsx` 的关系：那张卡继续负责详情、下载与进度；公告条只做
 * "去那儿看看"的入口，所以它在 `/settings` 上**不显示**（`hideOnPaths`）。
 */
import { useEffect } from "react";
import { checkForUpdate } from "../../api/settings";
import { t } from "../../i18n";
import { clearAnnouncement, postAnnouncement } from "./announcementStore";

export function useUpdateAnnouncement(enabled = true): void {
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    void checkForUpdate(false)
      .then((result) => {
        if (cancelled) return;
        if (result.update_available) {
          postAnnouncement({
            code: "update.ready",
            severity: "warning",
            message: t("announcement.update.ready"),
            action: { label: t("announcement.update.action"), to: "/settings" },
            generation: result.latest_version || result.current_version,
            hideOnPaths: ["/settings"],
          });
          return;
        }
        clearAnnouncement("update.ready");
        if (result.installable) {
          postAnnouncement({
            code: "update.downloaded",
            severity: "warning",
            message: t("announcement.update.downloaded"),
            action: { label: t("announcement.update.action"), to: "/settings" },
            generation: result.latest_version || result.current_version,
            hideOnPaths: ["/settings"],
          });
        } else {
          clearAnnouncement("update.downloaded");
        }
      })
      // 公告是"锦上添花"：检查更新失败不该在界面上留下任何痕迹（设置页会如实报错）。
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [enabled]);
}
