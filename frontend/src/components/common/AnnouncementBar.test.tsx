// SPDX-License-Identifier: Apache-2.0
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { t } from "../../i18n";
import AnnouncementBar, { pickVisible, severityRank } from "./AnnouncementBar";
import type { Announcement } from "../../features/announcements/announcementStore";
import {
  postAnnouncement,
  resetAnnouncementsForTest,
} from "../../features/announcements/announcementStore";
import { ANNOUNCEMENT_CODES } from "../../features/announcements/announcementCodes";
import { unmuteAnnouncement } from "../../features/announcements/announcementMute";

afterEach(cleanup);

beforeEach(() => {
  window.localStorage.clear();
  // 静音有一份模块级内存兜底（隐私模式下的降级路径），不清会让后面的用例"凭空看不到公告"。
  for (const code of ANNOUNCEMENT_CODES) unmuteAnnouncement(code);
  resetAnnouncementsForTest();
});

function renderBar(list: Announcement[], path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AnnouncementBar announcements={list} />
    </MemoryRouter>,
  );
}

const warning: Announcement = {
  code: "update.ready",
  severity: "warning",
  message: "有新版本可用",
};

const error: Announcement = {
  code: "dataset.error",
  severity: "error",
  message: "当前数据集读取失败",
};

describe("选取顺序", () => {
  it("error 优先于 warning", () => {
    expect(severityRank("error")).toBeLessThan(severityRank("warning"));
    expect(pickVisible([warning, error], "/")?.code).toBe("dataset.error");
  });

  it("同 severity 时 priority 小者先显示", () => {
    const low = { ...warning, code: "update.downloaded" as const, priority: 10 };
    const high = { ...warning, code: "update.ready" as const, priority: 200 };
    expect(pickVisible([high, low], "/")?.code).toBe("update.downloaded");
  });

  it("hideOnPaths 命中就不显示", () => {
    const item = { ...warning, hideOnPaths: ["/settings"] };
    expect(pickVisible([item], "/settings")).toBeNull();
    expect(pickVisible([item], "/jobs")).not.toBeNull();
  });
});

describe("渲染", () => {
  it("同一时刻只渲染 1 条", () => {
    renderBar([warning, error]);
    expect(document.querySelectorAll(".rf-announcement")).toHaveLength(1);
  });

  it("× 只关掉这一条，下一条立刻顶上来", () => {
    renderBar([warning, error]);
    // error 优先显示，所以先关掉的是它；关完 warning 立刻顶上来。
    expect(screen.getByText(error.message)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("announcement.dismiss") }));
    expect(screen.getByText(warning.message)).toBeInTheDocument();
  });

  it("关掉之后内容区不再出现（删除记忆生效）", () => {
    const { unmount } = renderBar([warning]);
    fireEvent.click(screen.getByRole("button", { name: t("announcement.dismiss") }));
    unmount();
    renderBar([warning]);
    expect(document.querySelector(".rf-announcement")).toBeNull();
  });

  it("「不再提醒」静音该来源，且不需要刷新（走 store 的读侧过滤）", () => {
    act(() => {
      postAnnouncement(warning);
    });
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AnnouncementBar />
      </MemoryRouter>,
    );
    expect(document.querySelector(".rf-announcement")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("announcement.mute") }));
    expect(document.querySelector(".rf-announcement")).toBeNull();
  });

  it("首帧就在的公告不带 live role；挂载后新增的带 role=status", () => {
    const first = renderBar([warning]);
    expect(document.querySelector(".rf-announcement")?.getAttribute("role")).toBeNull();
    first.unmount();

    // 挂载之后才出现的公告走 live region；组件内部按"首次快照"判定，所以必须经 store 变更。
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AnnouncementBar />
      </MemoryRouter>,
    );
    expect(document.querySelector(".rf-announcement")).toBeNull();
    act(() => {
      postAnnouncement(warning);
    });
    expect(document.querySelector(".rf-announcement")?.getAttribute("role")).toBe("status");
  });
});
