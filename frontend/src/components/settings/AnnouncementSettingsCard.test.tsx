// SPDX-License-Identifier: Apache-2.0
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { t } from "../../i18n";
import { ANNOUNCEMENT_CODES } from "../../features/announcements/announcementCodes";
import {
  MUTE_KEY_PREFIX,
  muteAnnouncement,
  unmuteAnnouncement,
} from "../../features/announcements/announcementMute";
import { resetAnnouncementsForTest } from "../../features/announcements/announcementStore";
import AnnouncementSettingsCard from "./AnnouncementSettingsCard";

afterEach(cleanup);

beforeEach(() => {
  window.localStorage.clear();
  for (const code of ANNOUNCEMENT_CODES) unmuteAnnouncement(code);
  resetAnnouncementsForTest();
});

function renderCard() {
  return render(
    <AntdApp>
      <AnnouncementSettingsCard />
    </AntdApp>,
  );
}

describe("AnnouncementSettingsCard", () => {
  it("卡片常驻：没有静音项时也渲染，并给空态", () => {
    renderCard();
    expect(screen.getByText(t("announcement.settings.title"))).toBeInTheDocument();
    expect(screen.getByText(t("announcement.settings.empty"))).toBeInTheDocument();
  });

  it("有静音项时逐行列出，并能恢复提醒", () => {
    muteAnnouncement("update.ready");
    renderCard();
    expect(screen.queryByText(t("announcement.settings.empty"))).toBeNull();
    expect(screen.getByText(t("announcement.update.ready"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("announcement.settings.restore") }));

    // 恢复后：键真的被删了，列表回到空态。
    expect(window.localStorage.getItem(`${MUTE_KEY_PREFIX}update.ready`)).toBeNull();
    expect(screen.getByText(t("announcement.settings.empty"))).toBeInTheDocument();
  });

  it("恢复成功给一条 Toast（告诉用户回页面才看得到）", async () => {
    muteAnnouncement("update.downloaded");
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: t("announcement.settings.restore") }));
    expect(await screen.findByText(t("toast.announcement.unmuted"))).toBeInTheDocument();
  });
});
