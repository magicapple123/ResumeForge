// SPDX-License-Identifier: Apache-2.0
/**
 * `WebFormProfileSection.applyParsedRows`（项 12）：识别结果 → 网申资料草稿的写入语义。
 *
 * 为什么单独成文件：这条命令是**唯一**能新增字段的入口（字段清单由 Section 自持，页面拿不到
 * 建字段的权力），它同时决定了两件容易写错的事：
 *
 * 1. **顺序**：新字段必须先落名字、再写值。反了会闪一帧"有值没名字"的字段；
 * 2. **勾选**：目录外的新字段默认不勾（D21）——没勾的行一个字都不能碰。
 *
 * 这里直接对 ref 暴露的句柄下断言（不去点整页），把这三条契约钉在组件边界上。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { createRef, type RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { WebFormExtraProfile, WebFormRepeatedGroup } from "../../types";
import type { RecognitionReviewRow } from "./RecognitionReviewList";
import WebFormProfileSection from "./WebFormProfileSection";
import type { WebFormProfileSectionHandle } from "./WebFormProfileSection";

const apiMocks = vi.hoisted(() => ({ getWebFormExtraProfile: vi.fn() }));

vi.mock("../../api/webform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/webform")>()),
  getWebFormExtraProfile: apiMocks.getWebFormExtraProfile,
}));

/** 一份最小目录：只有一个预设字段，别的都得靠识别新增。 */
const PROFILE: WebFormExtraProfile = {
  fields: [
    {
      key: "cet6_score",
      label: "英语六级分数",
      group: "语言与证书",
      kind: "text",
      sensitive: false,
    },
  ],
  groups: ["语言与证书"],
  values: {},
  details: {},
  repeated_groups: [],
};

/** 目录行（`isNew` 不设）：`id` 就是字段 key。 */
function catalogRow(value = "512"): RecognitionReviewRow {
  return { id: "cet6_score", section: "语言与证书", label: "英语六级分数", value };
}

/** 目录外的新字段行；`selected` 决定是否真的新增（默认不勾 = D21）。 */
function newRow(overrides: Partial<RecognitionReviewRow> = {}): RecognitionReviewRow {
  return {
    id: "CUSTOM_是否有驾照",
    section: "自定义",
    label: "是否有驾照",
    value: "C1",
    isNew: true,
    selected: true,
    ...overrides,
  };
}

interface Handles {
  handleRef: RefObject<WebFormProfileSectionHandle | null>;
  onChange: Mock;
  onFieldLabelChange: Mock;
  onFieldDelete: Mock;
  onRepeatedGroupsChange: Mock;
}

const REPEATED_GROUPS: WebFormRepeatedGroup[] = [];

/** 挂载 Section 并等目录加载完（`profileRef` 未就绪时写入没有意义）。 */
async function mountSection(): Promise<Handles> {
  const onChange = vi.fn();
  const onFieldLabelChange = vi.fn();
  const onFieldDelete = vi.fn();
  const onRepeatedGroupsChange = vi.fn();
  const onLoaded = vi.fn();
  const handleRef = createRef<WebFormProfileSectionHandle>();

  render(
    <AntdApp>
      <WebFormProfileSection
        ref={handleRef}
        editing
        saving={false}
        values={{}}
        details={{}}
        onChange={onChange}
        onFieldLabelChange={onFieldLabelChange}
        onFieldDelete={onFieldDelete}
        repeatedGroups={REPEATED_GROUPS}
        onRepeatedGroupsChange={onRepeatedGroupsChange}
        onLoaded={onLoaded}
      />
    </AntdApp>,
  );
  // 说明条出现 = 目录已取回，句柄里的 `profileRef` 才是可用的。
  await screen.findByText("这一区只给「网申填表」用，不会进入简历");
  await waitFor(() => expect(apiMocks.getWebFormExtraProfile).toHaveBeenCalled());
  expect(handleRef.current).not.toBeNull();
  return { handleRef, onChange, onFieldLabelChange, onFieldDelete, onRepeatedGroupsChange };
}

/** 命令式写入是"渲染外"的状态更新，必须包在 `act` 里。 */
function apply(handles: Handles, rows: RecognitionReviewRow[]): void {
  act(() => {
    handles.handleRef.current?.applyParsedRows(rows);
  });
}

beforeEach(() => {
  apiMocks.getWebFormExtraProfile.mockReset().mockResolvedValue(PROFILE);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("WebFormProfileSection.applyParsedRows", () => {
  it("目录内的行：只写值，不动字段名", async () => {
    const handles = await mountSection();

    apply(handles, [catalogRow("512")]);

    expect(handles.onChange).toHaveBeenCalledTimes(1);
    expect(handles.onChange).toHaveBeenCalledWith("cet6_score", "512");
    // 目录行本来就有名字：改名意味着动了目录，不该发生在写入识别结果时。
    expect(handles.onFieldLabelChange).not.toHaveBeenCalled();
  });

  it("勾选了的新字段：先落名字、再写值（顺序不能反）", async () => {
    const handles = await mountSection();

    apply(handles, [newRow()]);

    expect(handles.onFieldLabelChange).toHaveBeenCalledTimes(1);
    expect(handles.onFieldLabelChange).toHaveBeenCalledWith("CUSTOM_是否有驾照", "是否有驾照");
    expect(handles.onChange).toHaveBeenCalledTimes(1);
    // 值写在**同一个** key 上：新字段的 key 由后端按 label 定，前端沿用（D32）。
    expect(handles.onChange).toHaveBeenCalledWith("CUSTOM_是否有驾照", "C1");
    // 反了会闪一帧"有值没名字"的字段，用户会以为识别写丢了栏目名。
    expect(handles.onFieldLabelChange.mock.invocationCallOrder[0]).toBeLessThan(
      handles.onChange.mock.invocationCallOrder[0],
    );
  });

  it("没勾的新字段：两个回调都不被调用（D21，一个都不勾就一个字都不碰）", async () => {
    const handles = await mountSection();

    apply(handles, [newRow({ selected: false })]);

    expect(handles.onFieldLabelChange).not.toHaveBeenCalled();
    expect(handles.onChange).not.toHaveBeenCalled();
  });

  it("同一个字段已经手动加过：不重复建，直接写值（幂等）", async () => {
    const handles = await mountSection();

    // 用户先手动加过一次（同名字段已在目录里）。
    fireEvent.change(screen.getByLabelText("新增自定义网申字段名称"), {
      target: { value: "是否有驾照" },
    });
    fireEvent.click(screen.getByRole("button", { name: /添\s*加/ }));
    expect(handles.onFieldLabelChange).toHaveBeenCalledTimes(1);
    expect(handles.onFieldLabelChange).toHaveBeenCalledWith("CUSTOM_是否有驾照", "是否有驾照");

    apply(handles, [newRow()]);

    // 名字没有再写一遍（否则会把用户可能改过的显示名覆盖回识别的猜测）。
    expect(handles.onFieldLabelChange).toHaveBeenCalledTimes(1);
    expect(handles.onChange).toHaveBeenLastCalledWith("CUSTOM_是否有驾照", "C1");
    // 目录里只有一个该字段（重复建会出现第二个输入框）。
    expect(screen.getAllByLabelText("是否有驾照")).toHaveLength(1);
  });

  it("空名字的新字段：跳过（既不能成 key，也不该写值）", async () => {
    const handles = await mountSection();

    apply(handles, [newRow({ id: "CUSTOM_", label: "   " })]);

    expect(handles.onFieldLabelChange).not.toHaveBeenCalled();
    expect(handles.onChange).not.toHaveBeenCalled();
  });
});
