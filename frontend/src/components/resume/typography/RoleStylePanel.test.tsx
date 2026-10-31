// SPDX-License-Identifier: Apache-2.0
/**
 * 角色面板：三层范围里的"同类段落"那一层。
 * 守三件事：来源标签三态、写 roles 域不伤其它键、目录缺基准时如实说明。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { TEMPLATE_CATALOG } from "../../../test/resumeFixtures";
import type { ResumeLayout, ResumeTemplateCatalog } from "../../../types";
import { makePreviewRef } from "../../ResumeLayoutControls.testkit";
import RoleStylePanel from "./RoleStylePanel";

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  format_config: { accent: "#123456" },
};

const STYLE_CATALOG = {
  ...TEMPLATE_CATALOG,
  role_fields: [
    { role: "name", label_key: "typography.role.name", props: ["font_scale", "color"] },
    { role: "body", label_key: "typography.role.body", props: ["line_height", "bullet", "indent"] },
  ],
  template_role_defaults: {
    classic: {
      name: { font_scale: 1.86 },
      body: { font_scale: 1, line_height: 1.7, bullet: "dot", indent: 0 },
    },
  },
} as unknown as ResumeTemplateCatalog;

function renderPanel(
  props: Partial<ComponentProps<typeof RoleStylePanel>> = {},
  onChange = vi.fn(),
) {
  render(
    <AntdApp>
      <RoleStylePanel layout={LAYOUT} catalog={STYLE_CATALOG} onChange={onChange} {...props} />
    </AntdApp>,
  );
  return onChange;
}

function lastLayout(onChange: ReturnType<typeof vi.fn>): ResumeLayout {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]?.[0] as ResumeLayout;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("RoleStylePanel", () => {
  it("未设置过时显示来自模板，并给出模板基准值", () => {
    renderPanel({ defaultOpenRoles: ["name"] });
    // 每个属性行都有一枚来源胶囊：至少出现一次即可（数量随属性表变化）。
    expect(screen.getAllByText(t("typography.source.template")).length).toBeGreaterThan(0);
    // classic 的姓名基准 1.86 来自 template_role_defaults，不是前端写死的数字。
    const row = screen.getByTestId("style-row-name-font_scale");
    expect(within(row).getByText(/1\.86×/)).toBeInTheDocument();
  });

  it("记住上次展开的角色：重新打开时不回到默认的姓名+正文", () => {
    // 直接写一份"上次只开着正文"的偏好：模拟用户上次点到这儿就关了制作台。
    window.localStorage.setItem("resumeforge.typography.openRoles.v1", JSON.stringify(["body"]));
    renderPanel({ defaultOpenRoles: ["name", "body"] });
    expect(screen.queryByTestId("style-row-name-font_scale")).toBeNull();
    expect(screen.getByTestId("style-row-body-line_height")).toBeInTheDocument();
  });

  it("点角色标题会改写偏好（写给下次打开）", () => {
    renderPanel({ defaultOpenRoles: ["name"] });
    const header = screen.getByText(t("typography.role.name")).closest(".ant-collapse-header");
    if (!header) throw new Error("role header not found");
    fireEvent.click(header);
    const stored = window.localStorage.getItem("resumeforge.typography.openRoles.v1");
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).not.toContain("name");
  });

  it("改一个角色属性只写 roles 域，其它覆盖原样保留", async () => {
    const onChange = renderPanel({ defaultOpenRoles: ["name"] });
    fireEvent.click(
      screen.getByRole("button", {
        name: t("typography.row.increaseAria", { label: t("typography.prop.font_scale") }),
      }),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    // 显示值 +0.02 是"生效比例"；落库要除回模板基准（1.86），否则后端会再乘一次。
    expect(lastLayout(onChange).format_config).toEqual({
      accent: "#123456",
      roles: { version: 1, name: { font_scale: 1.0108 } },
    });
  });

  it("已有角色覆盖时来源变成同类段落已调整，恢复后角色键消失", async () => {
    const layout = {
      ...LAYOUT,
      format_config: {
        accent: "#123456",
        roles: { version: 1, body: { bullet: "dash" } },
      },
    } as unknown as ResumeLayout;
    const onChange = renderPanel({ layout, defaultOpenRoles: ["body"] });
    expect(await screen.findByText(t("typography.source.role"))).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: t("workbench.param.restoreToOpenedAria", {
          label: t("typography.prop.bullet"),
        }),
      }),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(lastLayout(onChange).format_config).toEqual({ accent: "#123456" });
  });

  it("拖动时的探针按 data-role 选择器注入预览", () => {
    const { ref, setLiveProbe } = makePreviewRef();
    renderPanel({ defaultOpenRoles: ["name"], previewRef: ref });
    fireEvent.click(
      screen.getByRole("button", {
        name: t("typography.row.increaseAria", { label: t("typography.prop.font_scale") }),
      }),
    );
    expect(setLiveProbe).toHaveBeenCalledWith(
      `  [data-role="name"] { font-size: calc(var(--fs) * 1.01075 * 1.86) !important; }`,
    );
  });

  it("目录没下发模板基准时明确提示起点为中性值", () => {
    renderPanel({ catalog: TEMPLATE_CATALOG, defaultOpenRoles: ["name"] });
    expect(screen.getByText(t("typography.catalog.missing"))).toBeInTheDocument();
  });
});
