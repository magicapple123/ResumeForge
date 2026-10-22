// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it } from "vitest";
import {
  isDismissed,
  dismissAnnouncement,
  postAnnouncement,
  clearAnnouncement,
  resetAnnouncementsForTest,
  useAnnouncements,
} from "./announcementStore";
import { renderHook } from "@testing-library/react";
import { ANNOUNCEMENT_CODES } from "./announcementCodes";

beforeEach(() => {
  window.localStorage.clear();
  resetAnnouncementsForTest();
});

describe("公告队列", () => {
  it("白名单就是四个来源（新增要显式改这里）", () => {
    expect(ANNOUNCEMENT_CODES).toEqual([
      "update.ready",
      "update.downloaded",
      "backend.degraded",
      "dataset.error",
    ]);
  });

  it("同 code 覆盖而不是堆两条", () => {
    postAnnouncement({ code: "update.ready", severity: "warning", message: "a" });
    postAnnouncement({ code: "update.ready", severity: "warning", message: "b" });
    const { result } = renderHook(() => useAnnouncements());
    expect(result.current).toHaveLength(1);
    expect(result.current[0].message).toBe("b");
  });

  it("clear 移除指定来源；移除不存在的来源不触发变化", () => {
    postAnnouncement({ code: "update.ready", severity: "warning", message: "a" });
    clearAnnouncement("update.ready");
    const { result } = renderHook(() => useAnnouncements());
    expect(result.current).toHaveLength(0);
  });
});

describe("已关闭记忆", () => {
  it("关过就记住；代次变了重新出现", () => {
    expect(isDismissed("update.ready", "1.0.2")).toBe(false);
    dismissAnnouncement("update.ready", "1.0.2");
    expect(isDismissed("update.ready", "1.0.2")).toBe(true);
    expect(isDismissed("update.ready", "1.0.3")).toBe(false);
  });

  it("不带代次时按 1 记", () => {
    dismissAnnouncement("backend.degraded");
    expect(isDismissed("backend.degraded")).toBe(true);
  });

  it("只存 code + 代次，不存正文", () => {
    dismissAnnouncement("update.ready", "1.0.2");
    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.getItem("resumeforge.announcement.dismissed.update.ready")).toBe(
      "1.0.2",
    );
  });
});
