import { describe, expect, it } from "vitest";
import {
  findBindingActionId,
  findConflict,
  formatShortcut,
  isModifierOnlyEvent,
  matches,
  normalizeBinding,
  normalizeEvent,
  validateShortcut,
} from "./matchShortcut";
import { defaultShortcutBindings } from "./registry";

function keyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("normalizeBinding", () => {
  it("统一大小写与修饰键顺序", () => {
    // 写成 Ctrl 的 `ctrl` 与平台无关的 `mod` 是两个部件：前者只在 mac 上表示 Control，
    // 后者才随平台切换。这条测试钉住"顺序固定"，避免同一组合有多种写法。
    expect(normalizeBinding("Shift+Ctrl+Z")).toBe("ctrl+shift+z");
    expect(normalizeBinding("ctrl+z")).toBe("ctrl+z");
    expect(normalizeBinding("Alt+Mod+N")).toBe("mod+alt+n");
  });

  it("空串与非字符串退化成空串", () => {
    expect(normalizeBinding("")).toBe("");
    expect(normalizeBinding("   ")).toBe("");
    // 运行时可能读到坏数据，这里不抛错。
    expect(normalizeBinding(undefined as unknown as string)).toBe("");
  });
});

describe("normalizeEvent 平台差异", () => {
  it("非 mac 用 ctrlKey 作 mod", () => {
    expect(normalizeEvent(keyEvent({ key: "z", ctrlKey: true }), { mac: false })).toBe("mod+z");
    expect(normalizeEvent(keyEvent({ key: "z", metaKey: true }), { mac: false })).toBe("meta+z");
  });

  it("mac 用 metaKey 作 mod，且 ctrl 不折叠成 mod", () => {
    expect(normalizeEvent(keyEvent({ key: "z", metaKey: true }), { mac: true })).toBe("mod+z");
    expect(normalizeEvent(keyEvent({ key: "z", ctrlKey: true }), { mac: true })).toBe("ctrl+z");
  });

  it("修饰键按固定顺序拼装", () => {
    expect(
      normalizeEvent(keyEvent({ key: "Z", ctrlKey: true, shiftKey: true }), { mac: false }),
    ).toBe("mod+shift+z");
    expect(
      normalizeEvent(keyEvent({ key: "n", ctrlKey: true, altKey: true }), { mac: false }),
    ).toBe("mod+alt+n");
  });

  it("按物理键位取主键（俄文/中文输入法下 KeyZ 仍是 z）", () => {
    expect(
      normalizeEvent(keyEvent({ key: "я", code: "KeyZ", ctrlKey: true }), { mac: false }),
    ).toBe("mod+z");
  });

  it("空格与功能键归一", () => {
    expect(
      normalizeEvent(keyEvent({ key: " ", code: "Space", ctrlKey: true }), { mac: false }),
    ).toBe("mod+space");
    expect(normalizeEvent(keyEvent({ key: "Escape", ctrlKey: true }), { mac: false })).toBe(
      "mod+escape",
    );
  });
});

describe("normalizeEvent 忽略项", () => {
  it("纯修饰键不算组合键", () => {
    expect(normalizeEvent(keyEvent({ key: "Shift", shiftKey: true }), { mac: false })).toBeNull();
    expect(normalizeEvent(keyEvent({ key: "Control", ctrlKey: true }), { mac: false })).toBeNull();
    expect(normalizeEvent(keyEvent({ key: "Meta", metaKey: true }), { mac: true })).toBeNull();
    expect(isModifierOnlyEvent(keyEvent({ key: "AltGraph", altKey: true }))).toBe(true);
  });

  it("AltGraph（AltGr 输入字符）不参与", () => {
    const event = keyEvent({ key: "q", ctrlKey: true, altKey: true });
    Object.defineProperty(event, "getModifierState", {
      value: (name: string) => name === "AltGraph",
    });
    expect(normalizeEvent(event, { mac: false })).toBeNull();
  });
});

describe("validateShortcut", () => {
  it("接受带修饰键的组合", () => {
    expect(validateShortcut("mod+z")).toEqual({ ok: true, binding: "mod+z" });
    // 大小写与写法归一，但 `Ctrl` 与平台无关的 `mod` 仍是两个部件（mac 上才是 Command）。
    expect(validateShortcut("Ctrl+Shift+Z")).toEqual({ ok: true, binding: "ctrl+shift+z" });
    expect(validateShortcut("mod+alt+n")).toEqual({ ok: true, binding: "mod+alt+n" });
  });

  it("拒绝浏览器/窗口保留组合", () => {
    for (const binding of ["mod+w", "mod+r", "mod+t", "mod+n"]) {
      expect(validateShortcut(binding)).toMatchObject({ ok: false, reason: "reserved" });
    }
    // 保留的是"不带 Shift"的那一组：mod+shift+w 可以绑。
    expect(validateShortcut("mod+shift+w")).toMatchObject({ ok: true });
  });

  it("拒绝没有 Ctrl/Cmd/Alt 的组合（含单字母与只按 Shift）", () => {
    expect(validateShortcut("z")).toMatchObject({ ok: false, reason: "noModifier" });
    expect(validateShortcut("mod+z").ok).toBe(true);
    expect(validateShortcut("shift+z")).toMatchObject({ ok: false, reason: "noModifier" });
  });

  it("拒绝只有修饰键与空组合", () => {
    expect(validateShortcut("mod+shift")).toMatchObject({ ok: false, reason: "modifierOnly" });
    expect(validateShortcut("")).toMatchObject({ ok: false, reason: "empty" });
  });
});

describe("matches 与 findBindingActionId", () => {
  const bindings = defaultShortcutBindings();

  it("命中默认组合", () => {
    expect(matches(keyEvent({ key: "k", ctrlKey: true }), "mod+k", { mac: false })).toBe(true);
    expect(matches(keyEvent({ key: "k" }), "mod+k", { mac: false })).toBe(false);
  });

  it("多组合的动作（恢复有两条）任意一条都命中", () => {
    expect(
      findBindingActionId(keyEvent({ key: "z", ctrlKey: true, shiftKey: true }), bindings, {
        mac: false,
      }),
    ).toBe("redo");
    expect(
      findBindingActionId(keyEvent({ key: "y", ctrlKey: true }), bindings, { mac: false }),
    ).toBe("redo");
  });

  it("未登记的组合不命中", () => {
    expect(
      findBindingActionId(keyEvent({ key: "p", ctrlKey: true }), bindings, { mac: false }),
    ).toBeNull();
    expect(
      findBindingActionId(keyEvent({ key: "Shift", shiftKey: true }), bindings, { mac: false }),
    ).toBeNull();
  });

  it("按用户改过的组合匹配", () => {
    const custom = { ...bindings, search: ["mod+p"] };
    expect(findBindingActionId(keyEvent({ key: "p", ctrlKey: true }), custom, { mac: false })).toBe(
      "search",
    );
  });
});

describe("findConflict", () => {
  const bindings = defaultShortcutBindings();

  it("撞上别的动作时报出那个动作", () => {
    expect(findConflict(bindings, "mod+z")).toBe("undo");
    expect(findConflict(bindings, "Ctrl+Shift+Y")).toBeNull();
    expect(findConflict(bindings, "MOD+SHIFT+Z")).toBe("redo");
  });

  it("排除自己的旧组合（改自己的键不算冲突）", () => {
    expect(findConflict(bindings, "mod+z", "undo")).toBeNull();
  });

  it("没人用时返回 null", () => {
    expect(findConflict(bindings, "mod+p")).toBeNull();
    expect(findConflict(bindings, "mod+shift+p")).toBeNull();
  });
});

describe("formatShortcut", () => {
  it("按平台给出可读文本", () => {
    expect(formatShortcut("mod+shift+z", { mac: false })).toBe("Ctrl+Shift+Z");
    expect(formatShortcut("mod+shift+z", { mac: true })).toBe("⌘⇧Z");
    expect(formatShortcut("mod+alt+n", { mac: false })).toBe("Ctrl+Alt+N");
  });
});
