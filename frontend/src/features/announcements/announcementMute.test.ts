// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MUTE_KEY_PREFIX,
  isMuted,
  listMutedCodes,
  muteAnnouncement,
  unmuteAnnouncement,
} from "./announcementMute";

beforeEach(() => {
  window.localStorage.clear();
  // 内存兜底也要清：模块级 Set 会跨用例留着。
  unmuteAnnouncement("update.ready");
  unmuteAnnouncement("update.downloaded");
  unmuteAnnouncement("backend.degraded");
  unmuteAnnouncement("dataset.error");
});

describe("静音存储", () => {
  it("写入值恒为 1，并落在带前缀的键上", () => {
    muteAnnouncement("update.ready");
    expect(window.localStorage.getItem(`${MUTE_KEY_PREFIX}update.ready`)).toBe("1");
    expect(isMuted("update.ready")).toBe(true);
  });

  it("unmute 真删键（不是写空串）", () => {
    muteAnnouncement("update.ready");
    unmuteAnnouncement("update.ready");
    expect(window.localStorage.getItem(`${MUTE_KEY_PREFIX}update.ready`)).toBeNull();
    expect(isMuted("update.ready")).toBe(false);
  });

  it("listMutedCodes 用前缀 slice 还原含点的 code", () => {
    muteAnnouncement("update.ready");
    muteAnnouncement("dataset.error");
    expect(listMutedCodes()).toEqual(["update.ready", "dataset.error"]);
  });

  it("白名单外的孤儿键被忽略，也不会让读取炸掉", () => {
    window.localStorage.setItem(`${MUTE_KEY_PREFIX}removed.feature`, "1");
    window.localStorage.setItem("unrelated.key", "1");
    expect(listMutedCodes()).toEqual([]);
  });

  it("与代次无关：换版本后仍然静音", () => {
    muteAnnouncement("update.ready");
    // 静音只认 code，不看 generation —— 这正是"别再烦我"的字面语义。
    expect(isMuted("update.ready")).toBe(true);
  });

  it("localStorage 抛错时降级为仅本会话，不崩", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => muteAnnouncement("backend.degraded")).not.toThrow();
    spy.mockRestore();
    // 内存里仍然生效：本会话内这条不会再来打扰。
    expect(isMuted("backend.degraded")).toBe(true);
  });
});
