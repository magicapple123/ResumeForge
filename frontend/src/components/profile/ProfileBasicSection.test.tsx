// SPDX-License-Identifier: Apache-2.0
/**
 * ProfileBasicSection（F6，F7 迁移版）：基本信息分区由定义驱动。
 *
 * 旧版守的是"微信号/QQ 是不是在基本信息卡片里"；新模型里这些网申专用项不再属于简历小字段，
 * 因此现在守：①字段顺序/标签来自 SectionOut.fields；②照片走专门入口（不渲染成文本输入）；
 * ③不在定义里的旧网申字段不会被渲染。
 */
import { App as AntdApp, Form } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProfileBasicSection from "./ProfileBasicSection";
import { makeField, makeSection } from "../../test/profileWorkspaceFixture";
import { t } from "../../i18n";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const SECTION = makeSection("basic_info", "Basic Info", "singleton", [
  makeField("basic_info", "name", "Name"),
  makeField("basic_info", "gender", "Gender"),
  makeField("basic_info", "photo", "Photo", { field_type: "photo" }),
]);

function renderSection() {
  return render(
    <AntdApp>
      <Form>
        <ProfileBasicSection
          section={SECTION}
          photo=""
          editing
          saving={false}
          onPhotoSelect={vi.fn()}
          onSetPreference={vi.fn()}
        />
      </Form>
    </AntdApp>,
  );
}

describe("ProfileBasicSection（定义驱动）", () => {
  it("文本字段按定义渲染，照片不进入文本输入", () => {
    renderSection();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Gender")).toBeInTheDocument();
    // 两个文本字段都有可关联的输入控件（照片字段不渲染成文本输入）。
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Gender")).toBeInTheDocument();
    expect(screen.queryByLabelText("Photo")).toBeNull();
  });

  it("照片保留专门入口（照片库面板），不属于通用字段输入", () => {
    renderSection();
    expect(screen.getByText(t("profileLibrary.photo.title"))).toBeInTheDocument();
    expect(screen.getByText(t("profileLibrary.photo.hint"))).toBeInTheDocument();
  });

  it("旧网申专用字段（微信/QQ/证件号）不再出现在基本信息里", () => {
    renderSection();
    for (const label of ["微信号", "QQ 号", "证件号码"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });
});
