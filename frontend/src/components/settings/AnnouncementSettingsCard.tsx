// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页的「公告提醒」卡片：**静音的唯一恢复入口**。
 *
 * 卡片**常驻**，不做"有静音项才显示"——只在有静音项时才出现的开关等于没有开关：
 * 用户是先想关、很久以后才想找回来。
 *
 * 一处刻意保留的错位：更新类公告带 `hideOnPaths: ["/settings"]`，所以在这里点「恢复提醒」
 * **当场看不到公告条**（同一页的 `UpdateCard` 正在说同一件事）。回到任意其它页面立刻出现
 * ——这是设计使然，不是 bug，所以恢复成功的 Toast 写的是"回到页面就能看到"。
 */
import { Button, Card, Empty, Space, Typography } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import { useToast } from "../../hooks/useToast";
import type { AnnouncementCode } from "../../features/announcements/announcementCodes";
import { listMutedCodes, unmuteAnnouncement } from "../../features/announcements/announcementMute";
import { notifyAnnouncements } from "../../features/announcements/announcementStore";

/** 静音项在界面上的名字复用公告自己的文案，**不另造一套 code 名称**（否则翻译两份、必然漂移）。 */
const CODE_LABELS: Partial<Record<AnnouncementCode, string>> = {
  "update.ready": t("announcement.update.ready"),
  "update.downloaded": t("announcement.update.downloaded"),
};

export default function AnnouncementSettingsCard() {
  const toast = useToast();
  const [muted, setMuted] = useState<AnnouncementCode[]>(() => listMutedCodes());

  const restore = (code: AnnouncementCode): void => {
    unmuteAnnouncement(code);
    setMuted(listMutedCodes());
    // 恢复后要"立刻出现"，不能等下一条公告：让读侧重算一次。
    notifyAnnouncements();
    toast.success(t("toast.announcement.unmuted"));
  };

  return (
    <Card title={t("announcement.settings.title")} size="small">
      {muted.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("announcement.settings.empty")}
        />
      ) : (
        <Space direction="vertical" size={8} style={{ width: "100%" }}>
          {muted.map((code) => (
            <div key={code} className="announcement-settings-row">
              <Typography.Text>{CODE_LABELS[code] ?? code}</Typography.Text>
              <Button size="small" onClick={() => restore(code)}>
                {t("announcement.settings.restore")}
              </Button>
            </div>
          ))}
        </Space>
      )}
    </Card>
  );
}
