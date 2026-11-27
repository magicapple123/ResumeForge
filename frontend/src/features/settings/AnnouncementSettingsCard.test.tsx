// SPDX-License-Identifier: Apache-2.0
/**
 * R20：「更新提醒」开关（并进「软件更新」卡的那一行）。
 *
 * 断言的是**行为**而不是排版：关掉 = 全部 code 都被静音（顶部黄条当场消失）、
 * 再打开 = 键被真删（不是写空串）、恢复时给一句"回页面才看得到"。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { t } from "../../i18n";
import { ANNOUNCEMENT_CODES } from "../announcements/announcementCodes";
import {
  MUTE_KEY_PREFIX,
  isMuted,
  muteAnnouncement,
  unmuteAnnouncement,
} from "../announcements/announcementMute";
import { resetAnnouncementsForTest } from "../announcements/announcementStore";
import AnnouncementReminderRow from "./AnnouncementSettingsCard";

afterEach(cleanup);

beforeEach(() => {
  window.localStorage.clear();
  for (const code of ANNOUNCEMENT_CODES) unmuteAnnouncement(code);
  resetAnnouncementsForTest();
});

function renderRow() {
  return render(
    <AntdApp>
      <AnnouncementReminderRow />
    </AntdApp>,
  );
}

/** antd 的 `Switch` 渲染成 `role="switch"`，可访问名来自 `aria-label`。 */
function switcher(): HTMLElement {
  return screen.getByRole("switch", { name: t("announcement.settings.title") });
}

describe("AnnouncementReminderRow（R20）", () => {
  it("默认开着：没有静音项时开关是勾选态", () => {
    renderRow();
    expect(screen.getByText(t("announcement.settings.title"))).toBeInTheDocument();
    expect(switcher()).toBeChecked();
  });

  it("关掉 = 白名单里的每个 code 都写入静音（黄条当场不再出现）", () => {
    renderRow();
    fireEvent.click(switcher());
    for (const code of ANNOUNCEMENT_CODES) {
      expect(window.localStorage.getItem(`${MUTE_KEY_PREFIX}${code}`)).toBe("1");
      expect(isMuted(code)).toBe(true);
    }
    expect(switcher()).not.toBeChecked();
  });

  it("再打开 = 键被真删（不是写空串），并给一句恢复提示", async () => {
    muteAnnouncement("update.downloaded");
    renderRow();
    expect(switcher()).not.toBeChecked();

    fireEvent.click(switcher());

    for (const code of ANNOUNCEMENT_CODES) {
      expect(window.localStorage.getItem(`${MUTE_KEY_PREFIX}${code}`)).toBeNull();
    }
    expect(switcher()).toBeChecked();
    // 更新类公告带 `hideOnPaths: ["/settings"]`：设置页里当场看不到，所以文案是"回页面"。
    expect(await screen.findByText(t("toast.announcement.unmuted"))).toBeInTheDocument();
  });
});
