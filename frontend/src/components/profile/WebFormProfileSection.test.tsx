import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebFormExtraProfile } from "../../types";
import WebFormProfileSection from "./WebFormProfileSection";

const apiMocks = vi.hoisted(() => ({
  getWebFormExtraProfile: vi.fn(),
}));

vi.mock("../../api/webform", () => ({
  getWebFormExtraProfile: apiMocks.getWebFormExtraProfile,
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const PROFILE: WebFormExtraProfile = {
  fields: [
    {
      key: "birth_date",
      label: "出生日期",
      group: "基本信息",
      kind: "date",
      sensitive: true,
      matchable: true,
    },
    {
      key: "custom_note",
      label: "备注",
      group: "基本信息",
      kind: "text",
      sensitive: false,
      matchable: true,
    },
  ],
  groups: ["基本信息"],
  values: { birth_date: "2000-01-01" },
  details: {},
  repeated_groups: [],
};

beforeEach(() => {
  apiMocks.getWebFormExtraProfile.mockReset();
  apiMocks.getWebFormExtraProfile.mockResolvedValue(PROFILE);
});

function renderSection(props: Partial<React.ComponentProps<typeof WebFormProfileSection>> = {}) {
  return render(
    <WebFormProfileSection
      editing
      saving={false}
      values={PROFILE.values}
      details={{}}
      onChange={vi.fn()}
      onFieldLabelChange={vi.fn()}
      onFieldDelete={vi.fn()}
      repeatedGroups={[]}
      onRepeatedGroupsChange={vi.fn()}
      onLoaded={vi.fn()}
      {...props}
    />,
  );
}

describe("WebFormProfileSection 只看已填写", () => {
  it("编辑态默认显示全部字段，开「只看已填写」后空字段消失、有值的保留", async () => {
    const view = renderSection();

    // 目录加载完成后两个字段都在（日期三连选的年份下拉是它的标志）。
    expect(await screen.findByLabelText("出生日期年份")).toBeInTheDocument();
    expect(screen.getByLabelText("备注")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "只看已填写" }));

    // 没填过的「备注」被过滤；有值的出生日期保留，开关变为可切回的「显示全部字段」。
    expect(await screen.findByRole("button", { name: "显示全部字段" })).toBeInTheDocument();
    expect(screen.getByLabelText("出生日期年份")).toBeInTheDocument();
    expect(screen.queryByLabelText("备注")).not.toBeInTheDocument();

    // 切回「显示全部字段」：备注回来。
    fireEvent.click(screen.getByRole("button", { name: "显示全部字段" }));
    expect(await screen.findByLabelText("备注")).toBeInTheDocument();
    view.unmount();
  });

  it("查看态永远只显示已填字段（开关不渲染，行为不回退）", async () => {
    renderSection({ editing: false, values: { birth_date: "2000-01-01", custom_note: "" } });

    // 查看态没有输入控件：出生日期显示标签与值，空字段「备注」整个不渲染。
    expect(await screen.findByText("出生日期")).toBeInTheDocument();
    expect(screen.getByText("2000-01-01")).toBeInTheDocument();
    expect(screen.queryByText("备注")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "只看已填写" })).not.toBeInTheDocument();
  });
});
