// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../../test/memoryStorage";
import {
  MAX_RECENT_COMMANDS,
  RECENT_COMMANDS_KEY,
  cycleActiveIndex,
  filterCommands,
  pickKnownCommandIds,
  pushRecentCommandId,
  readRecentCommandIds,
} from "./commandPalette";
import type { ProviewCommand } from "./types";

function command(id: string, label: string, keywords: string[] = []): ProviewCommand {
  return { id, label, keywords, run: () => undefined };
}

const COMMANDS = [
  command("save", "Save changes", ["persist"]),
  command("export", "Export resume", ["download", "pdf"]),
  command("zoom.in", "Zoom in", ["bigger"]),
  command("guides", "Toggle guides", ["margin", "baseline"]),
];

describe("命令面板过滤（D13）", () => {
  it("空查询返回全部；按标签/关键词/多词过滤", () => {
    expect(filterCommands(COMMANDS, "")).toEqual(COMMANDS);
    expect(filterCommands(COMMANDS, "zoom").map((item) => item.id)).toEqual(["zoom.in"]);
    expect(filterCommands(COMMANDS, "pdf").map((item) => item.id)).toEqual(["export"]);
    expect(filterCommands(COMMANDS, "toggle margin").map((item) => item.id)).toEqual(["guides"]);
    expect(filterCommands(COMMANDS, "nothing")).toEqual([]);
  });

  it("大小写不敏感；标签前缀命中排在其他命中之前", () => {
    const items = [command("a", "Open settings"), command("b", "Settings dialog")];
    expect(filterCommands(items, "SETTINGS").map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("↑↓ 在两端回绕；空列表返回 -1", () => {
    expect(cycleActiveIndex(-1, 1, 3)).toBe(0);
    expect(cycleActiveIndex(-1, -1, 3)).toBe(2);
    expect(cycleActiveIndex(2, 1, 3)).toBe(0);
    expect(cycleActiveIndex(0, -1, 3)).toBe(2);
    expect(cycleActiveIndex(0, 1, 0)).toBe(-1);
  });
});

describe("最近使用（D13）", () => {
  it("按 id 去重、最新在前、上限截断", () => {
    const storage = createMemoryStorage();
    for (let index = 0; index < MAX_RECENT_COMMANDS + 3; index += 1) {
      pushRecentCommandId("cmd-" + index, storage);
    }
    const ids = readRecentCommandIds(storage);
    expect(ids).toHaveLength(MAX_RECENT_COMMANDS);
    expect(ids[0]).toBe("cmd-" + (MAX_RECENT_COMMANDS + 2));
    pushRecentCommandId("cmd-3", storage);
    expect(readRecentCommandIds(storage)[0]).toBe("cmd-3");
  });

  it("坏数据 / 存储缺失都安静回退", () => {
    const storage = createMemoryStorage();
    storage.setItem(RECENT_COMMANDS_KEY, "{bad");
    expect(readRecentCommandIds(storage)).toEqual([]);
    storage.setItem(RECENT_COMMANDS_KEY, "[1,2]");
    expect(readRecentCommandIds(storage)).toEqual([]);
    expect(readRecentCommandIds(null)).toEqual([]);
  });

  it("只保留仍然存在的命令 id，且去重", () => {
    expect(pickKnownCommandIds(["save", "gone", "save", "export"], COMMANDS)).toEqual([
      "save",
      "export",
    ]);
  });
});
