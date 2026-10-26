// SPDX-License-Identifier: Apache-2.0
/** 识别 hook（F6）：只消费服务端新目录草稿；不维护旧→新映射。 */
import { App as AntdApp } from "antd";
import type { FormInstance } from "antd";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const parseProfileText = vi.hoisted(() => vi.fn());
vi.mock("../../api/profile", () => ({ parseProfileText }));

import { makeField, makeSection, makeWorkspace } from "../../test/profileWorkspaceFixture";
import type { ProfileFormValues } from "../profile-library/types";
import { useProfileRecognition } from "./useProfileRecognition";
import type { ProfileDraftSection } from "./useProfileRecognition";

const workspace = makeWorkspace({
  sections: [
    makeSection("basic_info", "Basic Info", "singleton", [
      makeField("basic_info", "name", "Name"),
      makeField("basic_info", "phone", "Phone", { hidden: true }),
    ]),
    makeSection("educations", "Education", "multi", [
      makeField("educations", "school", "School"),
      makeField("educations", "major", "Major", { field_type: "multi_line" }),
    ]),
    makeSection("summary", "Summary", "singleton", [
      makeField("summary", "content", "Content", { field_type: "multi_line" }),
    ]),
  ],
});

type SetFieldCall = [(string | number)[], unknown];

function makeForm() {
  const calls: SetFieldCall[] = [];
  const form = {
    setFieldValue: vi.fn((path: SetFieldCall[0], value: unknown) => {
      calls.push([path, value]);
    }),
    getFieldValue: vi.fn(() => []),
  };
  return { form: form as unknown as FormInstance<ProfileFormValues>, calls };
}

function renderRecognition(form: FormInstance<ProfileFormValues>, onDirty = vi.fn()) {
  const wrapper = ({ children }: { children: ReactNode }) => <AntdApp>{children}</AntdApp>;
  const view = renderHook(() => useProfileRecognition({ form, workspace, onDirty }), { wrapper });
  return { ...view, onDirty };
}

function draft(sections: ProfileDraftSection[]): Record<string, unknown> {
  return { sections, warnings: [], parse_engine: "local", recognized_text: "" };
}

async function parseWith(result: { current: ReturnType<typeof useProfileRecognition> }) {
  act(() => result.current.openModal());
  act(() => result.current.modal.onTextChange("resume text"));
  await act(async () => {
    await result.current.modal.onParse();
  });
}

// 每个用例结束必须卸载。apply 会调用 App 的 message.success / message.warning，
// 每条通知都挂着一个「到点自动关闭」的 requestAnimationFrame 循环，只有卸载组件才会取消。
// 不卸载时循环在文件跑完后还会继续 setState；CI 上若这次更新落在 worker 拆除 jsdom
// （window 已被删除）之后，React 调度器读 window.event 就会抛
// "ReferenceError: window is not defined"（CI run 40241568883 的两个 Unhandled Error）。
// 仓库里其余渲染测试同样依赖显式 cleanup 保持这条隔离边界。
afterEach(() => {
  cleanup();
});

describe("useProfileRecognition", () => {
  beforeEach(() => {
    parseProfileText.mockReset();
  });

  it("rows come from the server catalog draft and hide hidden fields", async () => {
    parseProfileText.mockResolvedValue(
      draft([
        {
          key: "basic_info",
          name: "Basic Info",
          fields: [
            { field_id: "basic_info.name", label: "Name", value: "Zhang" },
            { field_id: "basic_info.phone", label: "Phone", value: "13800000000" },
          ],
        },
        {
          key: "educations",
          name: "Education",
          fields: [
            { field_id: "educations.school", label: "School", value: "Tianjin" },
            { field_id: "educations.major", label: "Major", value: "Software" },
          ],
        },
      ]),
    );
    const { form } = makeForm();
    const { result } = renderRecognition(form);
    await parseWith(result);

    const rows = result.current.modal.rows ?? [];
    expect(rows.some((row) => row.id.includes("basic_info.name"))).toBe(true);
    expect(rows.some((row) => row.id.includes("educations.school"))).toBe(true);
    expect(rows.some((row) => row.id.includes("basic_info.phone"))).toBe(false);
    expect(rows.find((row) => row.id.includes("educations.major"))?.multiline).toBe(true);
  });

  it("older responses without sections produce no rows (no legacy remap)", async () => {
    parseProfileText.mockResolvedValue({
      name: "Zhang",
      summary: "text",
      educations: [{ school: "Tianjin", cet4_score: "500" }],
      warnings: [],
      parse_engine: "local",
      recognized_text: "",
    });
    const { form, calls } = makeForm();
    const { result } = renderRecognition(form);
    await parseWith(result);

    expect(result.current.modal.rows).toEqual([]);
    act(() => result.current.modal.onApply?.());
    expect(calls).toHaveLength(0);
  });

  it("apply writes singleton fields and appends multi entry drafts", async () => {
    parseProfileText.mockResolvedValue(
      draft([
        {
          key: "basic_info",
          name: "Basic Info",
          fields: [{ field_id: "basic_info.name", label: "Name", value: "Zhang" }],
        },
        {
          key: "educations",
          name: "Education",
          fields: [{ field_id: "educations.school", label: "School", value: "A" }],
          entries: [
            { fields: [{ field_id: "educations.school", label: "School", value: "A" }] },
            { fields: [{ field_id: "educations.school", label: "School", value: "B" }] },
          ],
        },
      ]),
    );
    const { form, calls } = makeForm();
    const { result, onDirty } = renderRecognition(form);
    await parseWith(result);
    act(() => result.current.modal.onApply?.());

    expect(onDirty).toHaveBeenCalledTimes(1);
    expect(result.current.modal.rows).toBeNull();
    const basicWrites = calls.filter(([path]) => path[1] === "basic_info");
    expect(basicWrites.length).toBeGreaterThan(0);
    const multiWrites = calls.filter(([path]) => path[1] === "educations");
    expect(multiWrites).toHaveLength(1);
    const appended = multiWrites[0][1] as Array<{ values: Record<string, string> }>;
    expect(appended.map((item) => item.values["educations.school"])).toEqual(["A", "B"]);
  });
});
