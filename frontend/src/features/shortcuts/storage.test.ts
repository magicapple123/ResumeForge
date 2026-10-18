import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SHORTCUT_STORAGE_KEY,
  defaultShortcutSettings,
  getShortcutSettings,
  parseShortcutSettings,
  resetShortcutSettings,
  restoreShortcutBinding,
  sanitizeShortcutSettings,
  saveShortcutSettings,
  shortcutKeysOf,
  subscribeShortcutSettings,
  updateShortcutBinding,
} from "./storage";

function readStored() {
  const raw = window.localStorage.getItem(SHORTCUT_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("默认值与坏数据", () => {
  it("存储为空时给出默认组合", () => {
    const settings = getShortcutSettings();
    expect(settings.version).toBe(1);
    expect(settings.bindings).toEqual(defaultShortcutSettings().bindings);
    expect(settings.bindings.redo).toEqual(["mod+shift+z", "mod+y"]);
  });

  it("坏 JSON 回落到默认而不是抛错", () => {
    window.localStorage.setItem(SHORTCUT_STORAGE_KEY, "{不是 JSON");
    expect(getShortcutSettings().bindings).toEqual(defaultShortcutSettings().bindings);
    expect(parseShortcutSettings("{")).toEqual(defaultShortcutSettings());
  });

  it("版本不认识时整份回落默认", () => {
    window.localStorage.setItem(
      SHORTCUT_STORAGE_KEY,
      JSON.stringify({ version: 99, bindings: { undo: ["mod+p"] } }),
    );
    expect(getShortcutSettings().bindings).toEqual(defaultShortcutSettings().bindings);
  });

  it("未知动作、非数组、非字符串项都被丢弃", () => {
    const settings = sanitizeShortcutSettings({
      version: 1,
      bindings: {
        undo: ["mod+p"],
        不存在的动作: ["mod+u"],
        save: "mod+s",
        search: ["mod+k", 42, null],
      },
    });
    expect(Object.keys(settings.bindings).sort()).toEqual(
      ["assistant", "newJob", "redo", "save", "search", "undo"].sort(),
    );
    expect(settings.bindings.undo).toEqual(["mod+p"]);
    // 全被过滤光的动作回落到默认。
    expect(settings.bindings.save).toEqual(["mod+s"]);
    expect(settings.bindings.search).toEqual(["mod+k"]);
  });

  it("不合法的组合被过滤；过滤光了回落默认", () => {
    const settings = sanitizeShortcutSettings({
      version: 1,
      bindings: {
        // 无修饰键的字母 + 浏览器保留键，都不该留下。
        undo: ["z", "mod+w"],
      },
    });
    expect(settings.bindings.undo).toEqual(["mod+z"]);
  });

  it("跨动作重复的组合只保留第一次出现", () => {
    const settings = sanitizeShortcutSettings({
      version: 1,
      bindings: {
        undo: ["mod+p"],
        redo: ["mod+p"],
      },
    });
    expect(settings.bindings.undo).toEqual(["mod+p"]);
    expect(settings.bindings.redo).toEqual(["mod+shift+z", "mod+y"]);
  });
});

describe("落库与广播", () => {
  it("保存后写入 rf.shortcuts.v1 并通知订阅者", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeShortcutSettings(listener);
    const next = updateShortcutBinding(defaultShortcutSettings(), "search", ["mod+p"]);

    expect(next.bindings.search).toEqual(["mod+p"]);
    expect(readStored()).toEqual({ version: 1, bindings: next.bindings });
    expect(listener).toHaveBeenCalledTimes(1);
    // 快照跟着变：keymap 立刻用新组合。
    expect(getShortcutSettings().bindings.search).toEqual(["mod+p"]);

    unsubscribe();
    saveShortcutSettings(defaultShortcutSettings());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("单条恢复默认只改那一个动作", () => {
    const changed = updateShortcutBinding(defaultShortcutSettings(), "search", ["mod+p"]);
    const restored = restoreShortcutBinding(changed, "search");
    expect(restored.bindings.search).toEqual(["mod+k"]);
    expect(getShortcutSettings().bindings.search).toEqual(["mod+k"]);
  });

  it("全部恢复默认写回默认组合", () => {
    updateShortcutBinding(defaultShortcutSettings(), "assistant", ["mod+p"]);
    const reset = resetShortcutSettings();
    expect(reset.bindings).toEqual(defaultShortcutSettings().bindings);
    expect(readStored()).toEqual({ version: 1, bindings: defaultShortcutSettings().bindings });
  });

  it("localStorage 不可写时仍然在内存里生效", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => updateShortcutBinding(defaultShortcutSettings(), "save", ["mod+p"])).not.toThrow();
    expect(getShortcutSettings().bindings.save).toEqual(["mod+p"]);
    setItem.mockRestore();
  });
});

describe("shortcutKeysOf", () => {
  it("规范化后返回；空数组回落默认", () => {
    const settings = saveShortcutSettings({
      version: 1,
      bindings: { undo: ["MOD+Z"], save: [] },
    });
    expect(shortcutKeysOf(settings, "undo")).toEqual(["mod+z"]);
    // 空数组会被清洗成默认值，这里取到的就是默认。
    expect(shortcutKeysOf(settings, "save")).toEqual(["mod+s"]);
  });
});
