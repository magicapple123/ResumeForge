// SPDX-License-Identifier: Apache-2.0
/**
 * ProfileSectionStack（F9）：大字段「在资料页显示/隐藏」之后的资料页形态。
 *
 * 隐藏 = 不在当前组参与清单里。资料页顶部必须有「已隐藏的大字段 (N)」入口，
 * 查看态也能逐项「显示」（写当前组参与清单，不进编辑态）；当前组只有基本信息时，
 * 空态要说明「当前组已隐藏全部大字段（基本信息除外）」并内嵌同一个入口。
 */
import { App as AntdApp, Form } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { createSectionOrderStore } from "../../features/profile/sectionOrderStore";
import { LIMITS, makeAllSections } from "../../test/profileWorkspaceFixture";
import ProfileSectionStack from "./ProfileSectionStack";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderStack(participatingKeys: string[], onSetSectionVisible = vi.fn()) {
  const store = createSectionOrderStore();
  const noop = vi.fn();
  render(
    <AntdApp>
      <Form>
        <ProfileSectionStack
          sections={makeAllSections()}
          participatingKeys={participatingKeys}
          reorderStore={store}
          editing={false}
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
          onOpenFieldSettings={noop}
          onOpenGuide={noop}
          onRequestEdit={noop}
          onOpenGroupManager={noop}
          onSetSectionVisible={onSetSectionVisible}
        />
      </Form>
    </AntdApp>,
  );
  return { onSetSectionVisible };
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
