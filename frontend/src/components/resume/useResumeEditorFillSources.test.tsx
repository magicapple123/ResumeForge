// SPDX-License-Identifier: Apache-2.0
/**
 * F10：已保存简历的编辑器视图必须「黏」在第一次读到的快照上。
 *
 * 真实背景：写端点（PUT/PATCH）返回的 ResumeOut 有意不含 profile_usage，保存一次之后
 * `detail.profile_usage` 会变成 undefined。若直接把它传给 `useProfileFillSources`，
 * 用户一保存，制作台/手动调整的页签与字段就跳回"当前方案"——正是用户要避免的行为。
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeDetail } from "../../types";
import type { ResumeProfileUsageSnapshot } from "../../types/resumeProfileUsage";
import { editorSchema, editorSection } from "../../test/editorSchemaFixture";
import { projectionOf } from "../../test/profileProjectionFixture";
import { useResumeEditorFillSources } from "./useResumeEditorFillSources";

const mocks = vi.hoisted(() => ({ projection: null as unknown }));

vi.mock("../../features/profile-library/useCurrentProjection", () => ({
  useCurrentProjection: () => ({
    data: mocks.projection,
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));

const SCHEMA = editorSchema(
  editorSection("custom:22333", "22333", [], { resume_field: "custom_sections" }),
);

function usage(editorSchemaValue = SCHEMA): ResumeProfileUsageSnapshot {
  return {
    group_name: "g",
    group_id: "g1",
    participating: [{ key: "custom:22333", name: "22333" }],
    section_order: ["custom:22333"],
    definition_revision: 0,
    data_revision: 0,
    created_at: "2026-10-26T00:00:00",
    group_deleted: false,
    editor_schema: editorSchemaValue,
  };
}

/** 只关心 id + profile_usage 的最小详情（其余字段与编辑器视图无关）。 */
function detail(id: number, profileUsage: ResumeProfileUsageSnapshot | null): ResumeDetail {
  return { id, profile_usage: profileUsage } as unknown as ResumeDetail;
}

beforeEach(() => {
  mocks.projection = projectionOf({ content: { name: "A" } });
});

describe("useResumeEditorFillSources（F10 冻结视图）", () => {
  it("写响应丢掉 profile_usage 后，冻结视图仍黏在这份简历上", () => {
    const { result, rerender } = renderHook(
      ({ record }: { record: ResumeDetail }) => useResumeEditorFillSources(true, record),
      { initialProps: { record: detail(7, usage()) } },
    );
    expect(result.current.fillSources?.editorView?.sections.map((s) => s.name)).toEqual(["22333"]);
    expect(result.current.fillSources?.editorView?.schema).toBe(SCHEMA);

    rerender({ record: detail(7, null) });
    expect(result.current.fillSources?.editorView?.schema).toBe(SCHEMA);
    expect(result.current.fillSources?.editorView?.sections[0].name).toBe("22333");
  });

  it("没有快照的旧简历不使用当前方案的视图（字段保持全部可见）", () => {
    mocks.projection = {
      ...projectionOf({ content: { name: "A" } }),
      editor_schema: SCHEMA,
    };
    const { result } = renderHook(
      ({ record }: { record: ResumeDetail }) => useResumeEditorFillSources(true, record),
      { initialProps: { record: detail(9, null) } },
    );
    // 当前投影带视图也不套上去：旧简历只按参与清单回退，字段全部可见。
    expect(result.current.fillSources?.editorView).toBeUndefined();
  });

  it("换一份简历（id 变化）时不沿用上一份的视图", () => {
    const { result, rerender } = renderHook(
      ({ record }: { record: ResumeDetail }) => useResumeEditorFillSources(true, record),
      { initialProps: { record: detail(7, usage()) } },
    );
    expect(result.current.fillSources?.editorView).toBeDefined();

    rerender({ record: detail(8, null) });
    expect(result.current.fillSources?.editorView).toBeUndefined();
  });
});
