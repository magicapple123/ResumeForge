// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../../test/memoryStorage";
import { createPhotoCropParams, DEFAULT_CROP_DRAFT } from "./photoCrop";
import {
  PHOTO_CROP_STORAGE_PREFIX,
  clearPhotoCrop,
  loadPhotoCrop,
  photoCropStorageKey,
  savePhotoCrop,
} from "./photoCropStore";

const PARAMS = createPhotoCropParams(
  { sha256: "b".repeat(64), width: 800, height: 600 },
  { ...DEFAULT_CROP_DRAFT, aspect: "1:1" },
);

describe("照片裁剪的会话级桥（provisional，白名单放行后删除）", () => {
  it("按简历隔离保存/读取/清除", () => {
    const storage = createMemoryStorage();
    expect(savePhotoCrop(7, PARAMS, storage)).toBe(true);
    expect(loadPhotoCrop(7, storage)).toEqual(PARAMS);
    expect(loadPhotoCrop(8, storage)).toBeNull();
    clearPhotoCrop(7, storage);
    expect(loadPhotoCrop(7, storage)).toBeNull();
  });

  it("键名带版本前缀，按 resumeId 后缀隔离", () => {
    expect(photoCropStorageKey(7)).toBe(PHOTO_CROP_STORAGE_PREFIX + ":7");
    expect(photoCropStorageKey(null)).toBeNull();
    expect(photoCropStorageKey(Number.NaN)).toBeNull();
  });

  it("坏 JSON / 旧版本参数 / 无存储都安静回退，不抛错", () => {
    const storage = createMemoryStorage();
    expect(loadPhotoCrop(1, storage)).toBeNull();
    storage.setItem(photoCropStorageKey(1) as string, "{bad");
    expect(loadPhotoCrop(1, storage)).toBeNull();
    storage.setItem(photoCropStorageKey(1) as string, JSON.stringify({ version: 99 }));
    expect(loadPhotoCrop(1, storage)).toBeNull();
    expect(loadPhotoCrop(1, null)).toBeNull();
    expect(savePhotoCrop(null, PARAMS, storage)).toBe(false);
    expect(() => clearPhotoCrop(null, storage)).not.toThrow();
  });
});
