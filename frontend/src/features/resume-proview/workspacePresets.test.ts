// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../../test/memoryStorage";
import {
  WORKSPACE_PRESET_IDS,
  WORKSPACE_PRESET_KEY,
  isWorkspacePresetId,
  panelsForWorkspace,
  readWorkspacePreset,
  useWorkspacePreset,
  writeWorkspacePreset,
} from "./workspacePresets";

describe("工作区预设（D14，只切面板可见性）", () => {
  it("四档预设的面板组合：画布恒开，参数/内容按预设切换", () => {
    expect(WORKSPACE_PRESET_IDS).toEqual(["default", "writing", "typography", "delivery"]);
    expect(panelsForWorkspace("default")).toEqual({ params: true, editor: true, canvas: true });
    expect(panelsForWorkspace("writing")).toEqual({ params: false, editor: true, canvas: true });
    expect(panelsForWorkspace("typography")).toEqual({ params: true, editor: false, canvas: true });
    expect(panelsForWorkspace("delivery")).toEqual({ params: false, editor: false, canvas: true });
  });

  it("返回值是副本：改它不会污染模块常量", () => {
    const panels = panelsForWorkspace("writing");
    panels.editor = false;
    expect(panelsForWorkspace("writing").editor).toBe(true);
  });

  it("只接受已知 id；坏值回默认", () => {
    expect(isWorkspacePresetId("writing")).toBe(true);
    expect(isWorkspacePresetId("workspace")).toBe(false);
    expect(isWorkspacePresetId(null)).toBe(false);
  });

  it("持久化：默认不写键；切预设写入；恢复默认删除键", () => {
    const storage = createMemoryStorage();
    expect(readWorkspacePreset(storage)).toBe("default");
    writeWorkspacePreset("typography", storage);
    expect(storage.getItem(WORKSPACE_PRESET_KEY)).toBe("typography");
    expect(readWorkspacePreset(storage)).toBe("typography");
    writeWorkspacePreset("default", storage);
    expect(storage.getItem(WORKSPACE_PRESET_KEY)).toBeNull();
    storage.setItem(WORKSPACE_PRESET_KEY, "garbage");
    expect(readWorkspacePreset(storage)).toBe("default");
    expect(readWorkspacePreset(null)).toBe("default");
  });

  it("hook 切换会持久化，reset 回默认", () => {
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useWorkspacePreset(storage));
    expect(result.current.panels).toEqual({ params: true, editor: true, canvas: true });
    act(() => result.current.setPreset("delivery"));
    expect(result.current.panels).toEqual({ params: false, editor: false, canvas: true });
    expect(readWorkspacePreset(storage)).toBe("delivery");
    act(() => result.current.reset());
    expect(result.current.preset).toBe("default");
    expect(readWorkspacePreset(storage)).toBe("default");
  });
});
