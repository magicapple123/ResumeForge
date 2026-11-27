// SPDX-License-Identifier: Apache-2.0
/**
 * 「更新提醒」开关：**静音与恢复的唯一入口**，一行、并进「软件更新」卡（R20）。
 *
 * ## 为什么不是一张独立的卡
 *
 * 改造前它是「公告提醒」卡：一张只在有静音项时才有一行内容、平时显示一句空态说明的卡片。
 * 空卡占的是同一屏里最贵的位置，而它要说的事只有一句——"更新提醒还响不响"。
 * 现在它并进 `UpdateCard`：一行「更新提醒 [开关]」，开关 = 该 code 是否被静音。
 *
 * ## 为什么开关管的是 `ANNOUNCEMENT_CODES` 里的全部 code
 *
 * 开关是**一个**用户概念（"别再跟我说更新的事"），而 code 是实现细节（`update.ready`
 * 只清不发、`update.downloaded` 才是真会出现的黄条）。逐个 code 摆开关会让用户面对一堆
 * 没有区别的选项，还会出现"关了一个、另一个照样弹"的自相矛盾。所以一次全静音 / 全恢复。
 *
 * ## 关掉之后会发生什么
 *
 * `announcementStore` 的读侧按 `isMuted` 过滤，`notifyAnnouncements()` 让读侧立刻重算：
 * 顶部黄条当场消失；恢复时同一次重算把它放回来。**不依赖刷新页面**——否则这个开关
 * 看起来像"下次启动才生效"。
 */
import { Switch, Typography } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useToast } from "../../hooks/useToast";
import type { AnnouncementCode } from "../announcements/announcementCodes";
import { ANNOUNCEMENT_CODES } from "../announcements/announcementCodes";
import { isMuted, muteAnnouncement, unmuteAnnouncement } from "../announcements/announcementMute";
import { notifyAnnouncements } from "../announcements/announcementStore";

/**
 * 开关读的那一条 code。
 *
 * `update.downloaded` 是**唯一真的会出现在公告条上的更新公告**（`update.ready` 只清不发，
 * 见 `useUpdateAnnouncement`），所以"更新提醒还响不响"等价于"这一条有没有被静音"。
 * 反过来写（"全部都被静音才算关"）会出现"关着呢但黄条还在"的自相矛盾。写操作仍然覆盖
 * 白名单里的**全部** code：开关是一个用户概念，不该因为实现里多了一条 code 就漏掉。
 */
const PRIMARY_CODE: AnnouncementCode = "update.downloaded";

export default function AnnouncementReminderRow() {
  useLocale();
  const toast = useToast();
  const [muted, setMuted] = useState<boolean>(() => isMuted(PRIMARY_CODE));

  const apply = (next: boolean): void => {
    const targets: readonly AnnouncementCode[] = ANNOUNCEMENT_CODES;
    for (const code of targets) {
      if (next) unmuteAnnouncement(code);
      else muteAnnouncement(code);
    }
    setMuted(isMuted(PRIMARY_CODE));
    // 让读侧重算一次：黄条当场消失 / 回来，不必等下一次公告。
    notifyAnnouncements();
    // 恢复时同一句话在设置页看不到（更新类公告带 `hideOnPaths: ["/settings"]`），
    // 所以文案说的是"回到页面就能看到"，不承诺当场出现。
    if (next) toast.success(t("toast.announcement.unmuted"));
  };

  return (
    <label className="update-reminder-row">
      <Switch
        size="small"
        checked={!muted}
        // 读屏用户需要一个名字：`Switch` 自身的可访问名不来自旁边的 `<span>`。
        aria-label={t("announcement.settings.title")}
        onChange={(checked) => apply(checked)}
      />
      <span className="update-reminder-row__label">{t("announcement.settings.title")}</span>
      <Typography.Text type="secondary" className="update-reminder-row__hint">
        {t("announcement.settings.hint")}
      </Typography.Text>
    </label>
  );
}
