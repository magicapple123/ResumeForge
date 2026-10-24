// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../../test/memoryStorage";
import {
  DEFAULT_PROVIEW_PREFERENCES,
  PROVIEW_PREFERENCES_KEY,
  normalizePreferences,
  readPreferences,
  useProviewPreferences,
  writePreferences,
} from "./preferences";

describe("专业视图偏好（localStorage，仅查看类）", () => {
  it("坏数据/缺字段收口为默认值", () => {
    expect(normalizePreferences(null)).toEqual(DEFAULT_PROVIEW_PREFERENCES);
    expect(normalizePreferences({ guides: { margins: "yes" }, proof: 1 })).toEqual(
      DEFAULT_PROVIEW_PREFERENCES,
    );
    expect(normalizePreferences({ guides: { baselines: true }, proof: true })).toEqual({
      guides: { margins: false, columns: false, baselines: true, paragraphs: false },
      proof: true,
    });
  });

  it("读写往返；坏 JSON 回默认值；存储不可用也不崩", () => {
    const storage = createMemoryStorage();
    expect(readPreferences(storage)).toEqual(DEFAULT_PROVIEW_PREFERENCES);
    const prefs = {
      guides: { margins: true, columns: false, baselines: true, paragraphs: false },
      proof: true,
    };
    writePreferences(prefs, storage);
    expect(readPreferences(storage)).toEqual(prefs);
    storage.setItem(PROVIEW_PREFERENCES_KEY, "{not json");
    expect(readPreferences(storage)).toEqual(DEFAULT_PROVIEW_PREFERENCES);
    expect(readPreferences(null)).toEqual(DEFAULT_PROVIEW_PREFERENCES);
    expect(() => writePreferences(prefs, null)).not.toThrow();
  });

  it("hook 的开关会持久化，reset 回默认并写回存储", () => {
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useProviewPreferences(storage));
    act(() => result.current.setGuides({ ...DEFAULT_PROVIEW_PREFERENCES.guides, margins: true }));
    expect(readPreferences(storage).guides.margins).toBe(true);
    act(() => result.current.setProof(true));
    expect(readPreferences(storage).proof).toBe(true);
    act(() => result.current.reset());
    expect(readPreferences(storage)).toEqual(DEFAULT_PROVIEW_PREFERENCES);
  });
});
