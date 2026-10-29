// SPDX-License-Identifier: Apache-2.0
/**
 * 「更多参数」细调区（对象面板）：
 * 守四件事：写 objects[id] 不伤角色域、恢复继承是删键、探针按 data-object-id 注入、
 * 以及**级别管住的四项不在这里**（2026-10-29 与「文字级别」合并后的去重口径）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { TEMPLATE_CATALOG } from "../../../test/resumeFixtures";
import type { ResumeLayout } from "../../../types";
import { makePreviewRef } from "../../ResumeLayoutControls.testkit";
import ObjectStylePanel from "./ObjectStylePanel";

const OBJECT_ID = "exp_12345678";

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  format_config: {
    accent: "#123456",
    roles: { version: 1, body: { line_height: 1.55 } },
    objects: { version: 1, prj_87654321: { bullet: "none" } },
  } as never,
};

function renderPanel(
  props: Partial<ComponentProps<typeof ObjectStylePanel>> = {},
  onChange = vi.fn(),
) {
  render(
    <AntdApp>
      <ObjectStylePanel
        layout={LAYOUT}
        catalog={TEMPLATE_CATALOG}
        objectId={OBJECT_ID}
        objectLabel="Star River"
        onChange={onChange}
        {...props}
      />
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
  vi.restoreAllMocks();
});

describe("ObjectStylePanel", () => {
  it("未选中对象时给出选择提示", () => {
    renderPanel({ objectId: null });
    expect(screen.getByText(t("typography.object.empty"))).toBeInTheDocument();
  });

  it("显示作用范围（只作用于这一条）", () => {
    renderPanel();
    expect(
      screen.getByText(t("typography.object.scope", { name: "Star River" })),
    ).toBeInTheDocument();
  });

  it("只列级别管不到的属性：字号 / 加粗 / 段前 / 段后不再出现", () => {
    renderPanel();
    for (const prop of ["font_scale", "bold", "space_before", "space_after"]) {
      expect(document.querySelector(`[data-testid="style-row-object-${prop}"]`)).toBeNull();
    }
    // 差集里的属性仍在（缩进是这批里最好认的一行）。
    expect(document.querySelector('[data-testid="style-row-object-indent"]')).not.toBeNull();
    // 去处写明了，用户不会以为功能被删。
    expect(screen.getByText(t("typography.object.levelHint"))).toBeInTheDocument();
  });

  it("改一个属性只写 objects[该条]，角色覆盖与其它条目不丢", async () => {
    const layout = {
      ...LAYOUT,
      format_config: {
        ...LAYOUT.format_config,
        objects: {
          version: 1,
          prj_87654321: { bullet: "none" },
          [OBJECT_ID]: { indent: 0.5 },
        },
      },
    } as unknown as ResumeLayout;
    const onChange = renderPanel({ layout });
    fireEvent.click(
      screen.getByRole("button", {
        name: t("typography.row.increaseAria", { label: t("typography.prop.indent") }),
      }),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(lastLayout(onChange).format_config).toEqual({
      accent: "#123456",
      roles: { version: 1, body: { line_height: 1.55 } },
      objects: {
        version: 1,
        prj_87654321: { bullet: "none" },
        [OBJECT_ID]: { indent: 0.55 },
      },
    });
  });

  it("恢复继承删掉该条键；清空这一条不碰角色域", async () => {
    const layout = {
      ...LAYOUT,
      format_config: {
        ...LAYOUT.format_config,
        objects: { version: 1, [OBJECT_ID]: { bullet: "dash" } },
      },
    } as unknown as ResumeLayout;
    const onChange = renderPanel({ layout });
    fireEvent.click(
      screen.getByRole("button", {
        name: t("workbench.param.restoreToOpenedAria", { label: t("typography.prop.bullet") }),
      }),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect((lastLayout(onChange).format_config as Record<string, unknown>).objects).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: t("typography.object.clear") }));
    expect(lastLayout(onChange).format_config).toEqual({
      accent: "#123456",
      roles: { version: 1, body: { line_height: 1.55 } },
    });
  });

  it("探针按 data-object-id 注入预览", () => {
    const { ref, setLiveProbe } = makePreviewRef();
    const layout = {
      ...LAYOUT,
      format_config: {
        ...LAYOUT.format_config,
        objects: { version: 1, [OBJECT_ID]: { indent: 0.5 } },
      },
    } as unknown as ResumeLayout;
    renderPanel({ layout, previewRef: ref });
    fireEvent.click(
      screen.getByRole("button", {
        name: t("typography.row.increaseAria", { label: t("typography.prop.indent") }),
      }),
    );
    expect(setLiveProbe).toHaveBeenCalledWith(
      `  [data-object-id="${OBJECT_ID}"] { padding-left: calc(var(--fs) * 0.55) !important; }`,
    );
  });
});
