// SPDX-License-Identifier: Apache-2.0
/**
 * 镜头设置（F18）：默认全关、三档保留期、坏数据回落。
 *
 * 这些断言看着琐碎，但它们守的是隐私红线：`enabled` 只认真正的 `true`，
 * 任何"truthy 字符串"都必须落成关闭——否则 localStorage 被手改一下就会在
 * 用户不知情时申请摄像头。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  CAMERA_SETTINGS_KEY,
  DEFAULT_CAMERA_SETTINGS,
  loadCameraSettings,
  normalizeCameraSettings,
  patchCameraSettings,
  saveCameraSettings,
} from "./cameraSettings";

describe("cameraSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("默认关闭镜头与计入总分", () => {
    expect(DEFAULT_CAMERA_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_CAMERA_SETTINGS.countInScore).toBe(false);
    expect(DEFAULT_CAMERA_SETTINGS.retentionDays).toBe(7);
  });

  it("enabled 只认布尔 true", () => {
    expect(normalizeCameraSettings({ enabled: "true" }).enabled).toBe(false);
    expect(normalizeCameraSettings({ enabled: 1 }).enabled).toBe(false);
    expect(normalizeCameraSettings({ enabled: true }).enabled).toBe(true);
  });

  it("保留期只接受 0 / 7 / 30，未知值回落 7 天", () => {
    expect(normalizeCameraSettings({ retentionDays: 0 }).retentionDays).toBe(0);
    expect(normalizeCameraSettings({ retentionDays: 30 }).retentionDays).toBe(30);
    expect(normalizeCameraSettings({ retentionDays: 365 }).retentionDays).toBe(7);
  });

  it("坏 JSON 读回默认值而不是抛错", () => {
    window.localStorage.setItem(CAMERA_SETTINGS_KEY, "{not json");
    expect(loadCameraSettings()).toEqual(DEFAULT_CAMERA_SETTINGS);
  });

  it("patch 只改指定字段并落盘", () => {
    patchCameraSettings({ enabled: true, analyze: false });
    const stored = loadCameraSettings();
    expect(stored.enabled).toBe(true);
    expect(stored.analyze).toBe(false);
    expect(stored.record).toBe(true);
  });

  it("保存后写回的是规范化结果", () => {
    saveCameraSettings({ ...DEFAULT_CAMERA_SETTINGS, retentionDays: 30, countInScore: true });
    const raw = JSON.parse(window.localStorage.getItem(CAMERA_SETTINGS_KEY) ?? "{}");
    expect(raw.retentionDays).toBe(30);
    expect(raw.countInScore).toBe(true);
  });
});
