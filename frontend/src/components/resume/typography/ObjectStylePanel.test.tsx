// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目排版」面板（Q12/Q14）：
 * 作用范围段控（整条 / 条目头 / 正文 / 灰字）、行清单随范围过滤、按范围读写与恢复、
 * 无关项隐藏/灰显、探针落到正确元素、以及"固定当前样式"按范围回调。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { TEMPLATE_CATALOG } from "../../../test/resumeFixtures";
import type { ResumeLayout } from "../../../types";
import type { ResumeEntry } from "../../../types/resumeDocument";
import { entry, fieldItem, listItem } from "../../../features/resume-document/documentFixtures";
import { readStyleDomains } from "../../../features/resume-layout/styleOverrides";
import { makePreviewRef } from "../../ResumeLayoutControls.testkit";
import ObjectStylePanel from "./ObjectStylePanel";

const OBJECT_ID = "exp_12345678";
const OTHER_ID = "prj_87654321";

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  format_config: {
    accent: "#123456",
    roles: { version: 1, body: { line_height: 1.55 } },
    objects: { version: 1, [OTHER_ID]: { bullet: "none" } },
  } as never,
};

function editableEntry(overrides: Partial<ResumeEntry> = {}): ResumeEntry {
  return entry({
    id: OBJECT_ID,
    items: [
      fieldItem({ id: "ob_item0001", placement: "title", value: "Star River" }),
      fieldItem({ id: "ob_item0002", placement: "meta", value: "2020" }),
      listItem({ id: "ob_item0003", placement: "body" }),
    ],
    ...overrides,
  });
}

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
        entry={editableEntry()}
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

function rowTestId(prop: string): string {
  return `[data-testid="style-row-object-${prop}"]`;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ObjectStylePanel · 作用范围（Q12）", () => {
  it("未选中对象时给出选择提示", () => {
    renderPanel({ objectId: null });
    expect(screen.getByText(t("typography.object.empty"))).toBeInTheDocument();
  });

  it("状态行说清目标与范围，段控与范围说明齐备", () => {
    renderPanel();
    expect(
      screen.getByText(
        t("typography.entryStyle.status", {
          name: "Star River",
          scope: t("typography.entryStyle.scope.object"),
        }),
      ),
    ).toBeInTheDocument();
    for (const scope of ["object", "entry_title", "body", "meta"] as const) {
      expect(screen.getByText(t(`typography.entryStyle.scope.${scope}`))).toBeInTheDocument();
    }
    expect(screen.getByText(t("typography.entryStyle.scopeHint.object"))).toBeInTheDocument();
  });

  it("整条范围：8 项全是级别管不到的属性", () => {
    renderPanel();
    for (const prop of ["font_scale", "bold", "space_before", "space_after"]) {
      expect(document.querySelector(rowTestId(prop))).toBeNull();
    }
    for (const prop of ["color", "indent", "bullet", "meta_align", "letter_spacing"]) {
      expect(document.querySelector(rowTestId(prop))).not.toBeNull();
    }
  });

  it("切到「条目头」：行清单收窄，写入 object_roles 而不是 objects", async () => {
    const onChange = renderPanel();
    fireEvent.click(screen.getByText(t("typography.entryStyle.scope.entry_title")));
    expect(document.querySelector(rowTestId("indent"))).toBeNull();
    expect(document.querySelector(rowTestId("meta_align"))).toBeNull();
    expect(document.querySelector(rowTestId("align"))).not.toBeNull();
    expect(screen.getByText(t("typography.entryStyle.scopeHint.entry_title"))).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: t("typography.row.increaseAria", { label: t("typography.prop.line_height") }),
      }),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const config = lastLayout(onChange).format_config as Record<string, unknown>;
    const objects = config.objects as Record<string, unknown>;
    expect(objects[OBJECT_ID]).toBeUndefined();
    expect(objects[OTHER_ID]).toEqual({ bullet: "none" });
    const objectRoles = config.object_roles as Record<string, Record<string, unknown>>;
    expect(objectRoles[`${OBJECT_ID}:entry_title`]).toMatchObject({
      line_height: expect.any(Number),
    });
  });

  it("「恢复「条目头」跟随模板」只清该范围的键", async () => {
    const layout = {
      ...LAYOUT,
      format_config: {
        accent: "#123456",
        object_roles: {
          version: 1,
          [`${OBJECT_ID}:entry_title`]: { line_height: 1.4 },
        },
      },
    } as unknown as ResumeLayout;
    const onChange = renderPanel({ layout });
    fireEvent.click(screen.getByText(t("typography.entryStyle.scope.entry_title")));
    fireEvent.click(
      screen.getByRole("button", {
        name: t("typography.entryStyle.restore", {
          scope: t("typography.entryStyle.scope.entry_title"),
        }),
      }),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(
      (lastLayout(onChange).format_config as Record<string, unknown>).object_roles,
    ).toBeUndefined();
  });

  it("整条范围恢复仍是「恢复这一条的全部继承」", async () => {
    const layout = {
      ...LAYOUT,
      format_config: {
        ...LAYOUT.format_config,
        objects: { version: 1, [OBJECT_ID]: { bullet: "dash" } },
      },
    } as unknown as ResumeLayout;
    const onChange = renderPanel({ layout });
    fireEvent.click(screen.getByRole("button", { name: t("typography.object.clear") }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect((lastLayout(onChange).format_config as Record<string, unknown>).objects).toBeUndefined();
  });
});

describe("ObjectStylePanel · 无关项（Q12）", () => {
  it("没有日期/元信息字段时不显示「日期位置」", () => {
    renderPanel({
      entry: editableEntry({
        items: [fieldItem({ id: "ob_item0001", placement: "title", value: "Star River" })],
      }),
    });
    expect(document.querySelector(rowTestId("meta_align"))).toBeNull();
  });

  it("正文没有要点时项目符号灰显并说明原因", () => {
    renderPanel({
      entry: editableEntry({
        items: [fieldItem({ id: "ob_item0001", placement: "title", value: "Star River" })],
      }),
    });
    fireEvent.click(screen.getByText(t("typography.entryStyle.scope.body")));
    const bulletRow = document.querySelector(rowTestId("bullet")) as HTMLElement;
    expect(bulletRow).not.toBeNull();
    expect(screen.getByText(t("typography.entryStyle.noBullets"))).toBeInTheDocument();
    // 项目符号这一行的滑杆不可点（灰显），其它行仍可用。
    const bulletRowButtons = bulletRow.querySelectorAll("button");
    expect([...bulletRowButtons].every((button) => (button as HTMLButtonElement).disabled)).toBe(
      true,
    );
  });
});

describe("ObjectStylePanel · 探针与固定（Q14）", () => {
  it("缩进探针落到 ul / .body-paragraph（不是条目根）", () => {
    const { ref, setLiveProbe } = makePreviewRef();
    const layout = {
      ...LAYOUT,
      format_config: {
        ...LAYOUT.format_config,
        objects: { version: 1, [OBJECT_ID]: { indent: 0.5 } },
      },
    } as unknown as ResumeLayout;
    renderPanel({ previewRef: ref, layout });
    fireEvent.click(
      screen.getByRole("button", {
        name: t("typography.row.increaseAria", { label: t("typography.prop.indent") }),
      }),
    );
    expect(setLiveProbe).toHaveBeenCalledWith(
      `  [data-object-id="${OBJECT_ID}"] ul, [data-object-id="${OBJECT_ID}"] .body-paragraph { padding-left: calc(var(--fs) * 0.55) !important; }`,
    );
  });

  it("固定当前样式按当前作用范围回调宿主", () => {
    const onFreeze = vi.fn();
    renderPanel({ onFreeze });
    fireEvent.click(screen.getByRole("button", { name: t("typography.painter.freeze") }));
    expect(onFreeze).toHaveBeenCalledWith("object");
    fireEvent.click(screen.getByText(t("typography.entryStyle.scope.body")));
    fireEvent.click(screen.getByRole("button", { name: t("typography.painter.freeze") }));
    expect(onFreeze).toHaveBeenLastCalledWith("body");
  });
});

describe("ObjectStylePanel · 对象层写入（既有行为不回归）", () => {
  it("改一个属性只写 objects[该条]，角色覆盖与其它条目不丢", async () => {
    const layout = {
      ...LAYOUT,
      format_config: {
        ...LAYOUT.format_config,
        objects: {
          version: 1,
          [OTHER_ID]: { bullet: "none" },
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
    const domains = readStyleDomains(lastLayout(onChange).format_config);
    expect(domains.objects[OBJECT_ID]).toMatchObject({ indent: 0.55 });
    expect(domains.objects[OTHER_ID]).toEqual({ bullet: "none" });
    expect(domains.roles.body).toEqual({ line_height: 1.55 });
  });
});
