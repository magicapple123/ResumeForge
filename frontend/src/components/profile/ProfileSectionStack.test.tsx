// SPDX-License-Identifier: Apache-2.0
/**
 * ProfileSectionStack（F9）：大字段「在资料页显示/隐藏」之后的资料页形态。
 *
 * 隐藏 = 不在当前组参与清单里。资料页顶部必须有「已隐藏的大字段 (N)」入口，
 * 查看态也能逐项「显示」（写当前组参与清单，不进编辑态）；当前组只有基本信息时，
 * 空态要说明「当前组已隐藏全部大字段（基本信息除外）」并内嵌同一个入口。
 */
import { App as AntdApp, Form } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { createSectionOrderStore } from "../../features/profile/sectionOrderStore";
import type { SectionOut } from "../../features/profile-library/types";
import { LIMITS, makeAllSections, makeSection } from "../../test/profileWorkspaceFixture";
import ProfileSectionStack from "./ProfileSectionStack";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderStack(
  participatingKeys: string[],
  onSetSectionVisible = vi.fn(),
  editing = false,
  sections: SectionOut[] = makeAllSections(),
) {
  const store = createSectionOrderStore();
  const noop = vi.fn();
  const onOpenFieldSettings = vi.fn();
  render(
    <AntdApp>
      <Form>
        <ProfileSectionStack
          sections={sections}
          participatingKeys={participatingKeys}
          reorderStore={store}
          editing={editing}
          saving={false}
          photo=""
          limits={LIMITS}
          collapsedSections={new Set()}
          onToggleCollapsed={noop}
          onPhotoSelect={noop}
          onHandlePointerDown={noop}
          onMoveByOffset={noop}
          onAddEntry={noop}
          onRemoveEntry={noop}
          onSetPreference={noop}
          onOpenFieldSettings={onOpenFieldSettings}
          onOpenGuide={noop}
          onRequestEdit={noop}
          onOpenGroupManager={noop}
          onSetSectionVisible={onSetSectionVisible}
        />
      </Form>
    </AntdApp>,
  );
  return { onSetSectionVisible, onOpenFieldSettings };
}

describe("ProfileSectionStack 的大字段隐藏/显示", () => {
  it("顶部显示已隐藏数量，逐项「显示」写回当前组参与清单", async () => {
    const { onSetSectionVisible } = renderStack(["basic_info", "educations"]);
    // 13 个系统大字段里只有教育参与 → 隐藏 11 个（基本信息恒参与，不算隐藏）。
    fireEvent.click(
      screen.getByRole("button", {
        name: t("profileLibrary.hiddenSections.button", { count: 11 }),
      }),
    );
    const restore = await screen.findByRole("button", {
      name: t("profileLibrary.hiddenSections.showAria", { name: "Skills" }),
    });
    fireEvent.click(restore);
    expect(onSetSectionVisible).toHaveBeenCalledWith("skills", true);
    // 基本信息没有隐藏入口，因此不会出现在「已隐藏」清单里。
    expect(
      screen.queryByRole("button", {
        name: t("profileLibrary.hiddenSections.showAria", { name: "Basic Info" }),
      }),
    ).not.toBeInTheDocument();
  });

  it("当前组只有基本信息时：空态说明全部大字段已隐藏，入口可逐项显示", async () => {
    const { onSetSectionVisible } = renderStack(["basic_info"]);
    expect(screen.getByText(t("profileLibrary.empty.groupTitle"))).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("profileLibrary.empty.showHidden") }),
    ).toBeEnabled();
    // 空态入口打开的是同一个「已隐藏的大字段」清单。
    fireEvent.click(screen.getByRole("button", { name: t("profileLibrary.empty.showHidden") }));
    const restore = await screen.findByRole("button", {
      name: t("profileLibrary.hiddenSections.showAria", { name: "Education" }),
    });
    fireEvent.click(restore);
    expect(onSetSectionVisible).toHaveBeenCalledWith("educations", true);
    // 清单里 12 项 = 13 个系统大字段 - 基本信息。
    expect(
      screen.getByRole("button", {
        name: t("profileLibrary.hiddenSections.button", { count: 12 }),
      }),
    ).toBeInTheDocument();
  });

  it("全部大字段都参与时不显示「已隐藏的大字段」入口", () => {
    renderStack(makeAllSections().map((section) => section.key));
    expect(
      screen.queryByRole("button", {
        name: t("profileLibrary.hiddenSections.button", { count: 0 }),
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(t("profileLibrary.empty.groupTitle"))).not.toBeInTheDocument();
  });
});

describe("ProfileSectionStack 的标题唯一性与字段设置入口", () => {
  // 改前这里必然失败（2 个）：分区壳的标题栏 + ProfileEntrySection 内容区的
  // `.profile-entry-section-header` 各渲染一次同名大字段标题。
  it("参与清单含 educations 时，分区标题在查看态只出现一次", () => {
    renderStack(["basic_info", "educations"]);
    expect(screen.getAllByText("Education")).toHaveLength(1);
  });

  it("编辑态同样只出现一次（标题栏是每张卡唯一的标题）", () => {
    renderStack(["basic_info", "educations"], vi.fn(), true);
    expect(screen.getAllByText("Education")).toHaveLength(1);
  });

  it("标题栏齿轮直达该大字段的字段设置（基本信息也有齿轮）", () => {
    const { onOpenFieldSettings } = renderStack(["basic_info", "educations"]);
    const gear = screen.getByRole("button", {
      name: t("profileLibrary.section.fieldSettingsAria", { name: "Education" }),
    });
    // 齿轮必须渲染在折叠按钮**之外**：按钮嵌按钮是非法结构，点齿轮会连带折叠整卡。
    expect(gear.closest(".profile-section-collapse-toggle")).toBeNull();
    expect(gear).toBeEnabled();

    fireEvent.click(gear);
    // 页面此前忽略了这个 key，弹层只能落到组/大字段列表；现在必须带上分区 key。
    expect(onOpenFieldSettings).toHaveBeenCalledWith("educations");

    // 2026-10-28 用户要求：基本信息的姓名/联系方式同样可隐藏、可加自定义字段，
    // 它和其他板块一样要有字段设置入口。
    const basicGear = screen.getByRole("button", {
      name: t("profileLibrary.section.fieldSettingsAria", { name: "Basic Info" }),
    });
    expect(basicGear.closest(".profile-section-collapse-toggle")).toBeNull();
    fireEvent.click(basicGear);
    expect(onOpenFieldSettings).toHaveBeenCalledWith("basic_info");
  });

  it("自建板块在标题旁挂「自建」标记，系统板块没有", () => {
    const sections = [
      ...makeAllSections(),
      makeSection("custom_side", "Side Projects", "multi", [], { is_builtin: false }),
    ];
    renderStack(["basic_info", "educations", "custom_side"], vi.fn(), false, sections);
    // 只有自建的那一张卡带标记；标记文案与标题是两段文本，不会干扰标题唯一性。
    expect(screen.getAllByText(t("profileLibrary.section.customBadge"))).toHaveLength(1);
    const customCard = document.querySelector('[data-profile-section-key="custom_side"]');
    if (!(customCard instanceof HTMLElement)) throw new Error("custom section card not found");
    expect(
      within(customCard).getByText(t("profileLibrary.section.customBadge")),
    ).toBeInTheDocument();
  });
});
