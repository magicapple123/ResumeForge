// SPDX-License-Identifier: Apache-2.0
/** 保存协调（F6）：批量条目原子保存 → 分区内顺序 → 全局顺序；409 保留输入。 */
import type { FormInstance } from "antd";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import { makeEntry, makeSection, makeWorkspace } from "../../test/profileWorkspaceFixture";
import { makeField } from "../../test/profileWorkspaceFixture";
import type { ProfileFormValues, WorkspaceOut } from "../profile-library/types";
import { useProfileSaveCoordinator } from "./useProfileSaveCoordinator";

function makeForm(validate: () => Promise<unknown> = async () => ({ sections: {} })) {
  return {
    validateFields: vi.fn(validate),
  } as unknown as FormInstance<ProfileFormValues>;
}

function workspaceWithEntries(): WorkspaceOut {
  const sections = [
    makeSection("basic_info", "Basic Info", "singleton", [makeField("basic_info", "name", "Name")]),
    makeSection("projects", "Projects", "multi", [makeField("projects", "name", "Name")]),
    makeSection("skills", "Skills", "multi", [makeField("skills", "name", "Name")]),
  ];
  return makeWorkspace({
    sections,
    entries: [
      makeEntry("projects", "p1", { "projects.name": "One" }, 0),
      makeEntry("projects", "p2", { "projects.name": "Two" }, 1),
    ],
    section_order: ["basic_info", "projects", "skills"],
  });
}

function setup(overrides: Partial<Parameters<typeof useProfileSaveCoordinator>[0]> = {}) {
  const api = {
    saveEntries: vi.fn().mockResolvedValue({ entries: [], workspace_revision: 4 }),
    reorderEntries: vi.fn().mockResolvedValue(undefined),
    setSectionOrder: vi.fn().mockResolvedValue(undefined),
  };
  const onSaved = vi.fn();
  const reloadWorkspace = vi.fn().mockResolvedValue(undefined);
  const invalidateProjection = vi.fn();
  const options = {
    workspace: workspaceWithEntries(),
    editing: true,
    loading: false,
    loadError: "",
    photoReading: false,
    form: makeForm(),
    collectChanges: vi.fn(() => []),
    getSectionOrder: vi.fn(() => ["basic_info", "projects", "skills"]),
    reloadWorkspace,
    onSaved,
    invalidateProjection,
    api,
    ...overrides,
  };
  const view = renderHook(() => useProfileSaveCoordinator(options));
  return { ...view, api, onSaved, reloadWorkspace, invalidateProjection, options };
}

async function submit(result: { current: ReturnType<typeof useProfileSaveCoordinator> }) {
  let outcome: string | undefined;
  await act(async () => {
    outcome = await result.current.submit();
  });
  return outcome;
}

describe("useProfileSaveCoordinator", () => {
  it("skips when the page is not editable", async () => {
    const { result } = setup({ editing: false });
    expect(await submit(result)).toBe("skipped");
  });

  it("returns invalid when the form fails validation", async () => {
    const { result, api } = setup({ form: makeForm(async () => Promise.reject(new Error("bad"))) });
    expect(await submit(result)).toBe("invalid");
    expect(api.saveEntries).not.toHaveBeenCalled();
  });

  it("saves entries then section order and reports success", async () => {
    const item = { section_key: "basic_info", values: { "basic_info.name": "Zhang" } };
    const order = ["basic_info", "projects", "skills"];
    const { result, api, onSaved, reloadWorkspace, invalidateProjection } = setup({
      collectChanges: vi.fn(() => [item]),
      getSectionOrder: vi.fn(() => order),
    });
    // 全局顺序未变：只保存条目。
    expect(await submit(result)).toBe("saved");
    expect(api.saveEntries).toHaveBeenCalledWith([item], 3);
    expect(api.setSectionOrder).not.toHaveBeenCalled();
    expect(api.reorderEntries).not.toHaveBeenCalled();
    expect(reloadWorkspace).toHaveBeenCalledTimes(1);
    expect(invalidateProjection).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("reorders only sections whose existing entry order changed", async () => {
    const workspace = workspaceWithEntries();
    const values = {
      sections: {
        projects: [
          { entry_key: "p2", values: { "projects.name": "Two" } },
          { entry_key: "p1", values: { "projects.name": "One" } },
        ],
      },
    } as unknown as ProfileFormValues;
    const { result, api } = setup({
      workspace,
      form: makeForm(async () => values),
      collectChanges: vi.fn(() => []),
    });
    expect(await submit(result)).toBe("saved");
    expect(api.reorderEntries).toHaveBeenCalledWith("projects", ["p2", "p1"], 4);
  });

  it("keeps input and reports a conflict without retrying", async () => {
    const conflict = new ApiError("内容已在其他窗口被修改", 409, {
      businessCode: "revision_conflict",
      payload: { detail: "x", code: "revision_conflict", revision: 7 },
    });
    const { result, api, onSaved } = setup({
      collectChanges: vi.fn(() => [
        { section_key: "basic_info", values: { "basic_info.name": "Zhang" } },
      ]),
    });
    api.saveEntries.mockRejectedValue(conflict);
    expect(await submit(result)).toBe("conflict");
    expect(result.current.conflictRevision).toBe(7);
    expect(result.current.error).toBeTruthy();
    expect(api.saveEntries).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("reports partial failure when only the order write fails", async () => {
    const { result, api, onSaved } = setup({
      collectChanges: vi.fn(() => [
        { section_key: "basic_info", values: { "basic_info.name": "Zhang" } },
      ]),
      getSectionOrder: vi.fn(() => ["basic_info", "skills", "projects"]),
    });
    api.setSectionOrder.mockRejectedValue(new Error("order down"));
    expect(await submit(result)).toBe("failed");
    expect(result.current.error).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("blocks a second submit while the first is in flight", async () => {
    let release: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const { result, api } = setup({
      collectChanges: vi.fn(() => [
        { section_key: "basic_info", values: { "basic_info.name": "Zhang" } },
      ]),
    });
    api.saveEntries.mockReturnValue(pending);
    let first: Promise<string> | undefined;
    await act(async () => {
      first = result.current.submit();
      await Promise.resolve();
    });
    const second = await result.current.submit();
    expect(second).toBe("skipped");
    release({ entries: [], workspace_revision: 4 });
    await act(async () => {
      await first;
    });
  });
});
