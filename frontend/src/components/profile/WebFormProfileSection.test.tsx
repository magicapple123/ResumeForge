// SPDX-License-Identifier: Apache-2.0
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import I18nProvider from "../../i18n/I18nProvider";
import { selectLocale } from "../../i18n/localeStore";
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
  selectLocale("zh-CN");
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
    <I18nProvider>
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
        onRequestEdit={vi.fn()}
        {...props}
      />
    </I18nProvider>,
  );
}

describe("WebFormProfileSection 只看已填写", () => {
  it("编辑态默认显示全部字段，开「只看已填写」后空字段消失、有值的保留", async () => {
    const view = renderSection();

    // 目录加载完成后两个字段都在（日期三连选的年份下拉是它的标志）。
    expect(await screen.findByLabelText("出生日期年份")).toBeInTheDocument();
    expect(screen.getByLabelText("备注")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: t("profileLibrary.webform.showFilledFields") }),
    );

    // 没填过的「备注」被过滤；有值的出生日期保留，开关变为可切回的「显示全部字段」。
    expect(
      await screen.findByRole("button", { name: t("profileLibrary.webform.showAllFields") }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("出生日期年份")).toBeInTheDocument();
    expect(screen.queryByLabelText("备注")).not.toBeInTheDocument();

    // 切回「显示全部字段」：备注回来。
    fireEvent.click(
      screen.getByRole("button", { name: t("profileLibrary.webform.showAllFields") }),
    );
    expect(await screen.findByLabelText("备注")).toBeInTheDocument();
    view.unmount();
  });

  it("查看态永远只显示已填字段（开关不渲染，行为不回退）", async () => {
    renderSection({ editing: false, values: { birth_date: "2000-01-01", custom_note: "" } });

    // 查看态没有输入控件：出生日期显示标签与值，空字段「备注」整个不渲染。
    expect(await screen.findByText("出生日期")).toBeInTheDocument();
    expect(screen.getByText("2000-01-01")).toBeInTheDocument();
    expect(screen.queryByText("备注")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("profileLibrary.webform.showFilledFields") }),
    ).not.toBeInTheDocument();
  });

  it("updates Web form labels when the interface locale changes", async () => {
    const onRequestEdit = vi.fn();
    renderSection({ editing: false, values: {}, onRequestEdit });
    const notice = await screen.findByRole("alert");
    expect(
      within(notice).getByText(t("profileLibrary.webform.sectionAlertTitle")),
    ).toBeInTheDocument();

    const editButton = screen.getByRole("button", {
      name: t("profileLibrary.action.fillWebForm"),
    });
    fireEvent.click(editButton);
    expect(onRequestEdit).toHaveBeenCalledOnce();

    act(() => selectLocale("en-US"));

    expect(
      screen.getByRole("button", { name: t("profileLibrary.action.fillWebForm") }),
    ).toBeInTheDocument();
  });

  it("localizes the directory load error and lets the user retry", async () => {
    apiMocks.getWebFormExtraProfile
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(PROFILE);
    renderSection();

    expect(
      await screen.findByText(t("profileLibrary.webform.sectionLoadFailed")),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: new RegExp(t("common.retry").split("").join("\\s*")),
      }),
    );
    expect(await screen.findByLabelText("出生日期年份")).toBeInTheDocument();
    expect(apiMocks.getWebFormExtraProfile).toHaveBeenCalledTimes(2);
  });
});

/**
 * 「自定义」板块默认就要在（用户原话："默认有一个空的自定义板块"），而且加字段的输入框
 * 长在这张卡片里，不是挂在一屏分组之后。上面那份目录**没有**自定义字段，正好覆盖这个默认。
 */
describe("WebFormProfileSection custom group", () => {
  /** 分组卡片容器：空态提示 → 底部插槽容器 → 卡片（再上一层就是整块 Section 的 Card）。 */
  function customGroupCard(hintText: string): HTMLElement {
    const hint = screen.getByText(hintText);
    const card = hint.closest("div")?.parentElement;
    expect(card).toBeTruthy();
    return card as HTMLElement;
  }

  it("renders the empty custom card with its add-field input while editing", async () => {
    renderSection();

    expect(
      await screen.findByText(t("profileLibrary.webform.customGroupName")),
    ).toBeInTheDocument();
    // 空态提示与添加入口都在**同一张**卡片里；编辑态那一句才提"在下方添加"。
    const card = customGroupCard(t("profileLibrary.webform.customEmptyEditing"));
    expect(within(card).getByText(t("profileLibrary.webform.customGroupName"))).toBeInTheDocument();
    expect(
      within(card).getByLabelText(t("profileLibrary.webform.addFieldAria")),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: t("profileLibrary.webform.addFieldAction") }),
    ).toBeInTheDocument();
    // 这不是"整块 Section"：别的分组的字段不在里面。
    expect(within(card).queryByText(PROFILE.fields[0].label)).toBeNull();
  });

  it("keeps the empty custom card in view mode without the add-field input", async () => {
    renderSection({ editing: false, values: { birth_date: "2000-01-01" } });

    expect(
      await screen.findByText(t("profileLibrary.webform.customGroupName")),
    ).toBeInTheDocument();
    // 查看态没有输入框，所以提示不能指向"下方添加"。
    expect(screen.getByText(t("profileLibrary.webform.customEmpty"))).toBeInTheDocument();
    expect(
      screen.queryByText(t("profileLibrary.webform.customEmptyEditing")),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(t("profileLibrary.webform.addFieldAria")),
    ).not.toBeInTheDocument();
  });

  it("keeps the add-field input reachable while a filter hides the custom card", async () => {
    renderSection();
    expect(
      await screen.findByText(t("profileLibrary.webform.customGroupName")),
    ).toBeInTheDocument();

    // 「只看已填」把空的自定义卡片整张过滤掉——添加入口不能跟着消失，否则正在编辑的
    // 用户会突然找不到加字段的地方（它现在长在那张卡片里）。
    fireEvent.click(
      screen.getByRole("button", { name: t("profileLibrary.webform.showFilledFields") }),
    );

    expect(screen.queryByText(t("profileLibrary.webform.customGroupName"))).toBeNull();
    expect(screen.getByLabelText(t("profileLibrary.webform.addFieldAria"))).toBeInTheDocument();
  });
});
