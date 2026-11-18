// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目排版」面板（Q12/Q14）：
 * 作用范围段控（整条 / 条目头 / 正文 / 灰字）、行清单随范围过滤、按范围读写与恢复、
 * 无关项隐藏/灰显、探针落到正确元素、以及"固定当前样式"按范围回调。
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ResumeLayout } from "../../../types";
import { fieldItem } from "../document/documentFixtures";
import { readStyleDomains } from "./styleOverrides";
import {
  LAYOUT,
  OBJECT_ID,
  OTHER_ID,
  editableEntry,
  lastLayout,
  renderPanel,
  rowTestId,
} from "./ObjectStylePanel.testkit";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ObjectStylePanel · 页眉字段（QW-6）", () => {
  const HEADER_ID = "hd_12345678";
  const HEADER_PATH = `header.${HEADER_ID}`;

  it("没有作用范围切换，只有「字段值 / 字段名」两个目标", () => {
    renderPanel({
      objectId: HEADER_PATH,
      headerField: { id: HEADER_ID, label: "13800000000" },
      pickedPath: HEADER_PATH,
      defaultScope: "field",
      fieldRole: "meta",
      entry: null,
    });
    expect(
      screen.queryByRole("radio", { name: t("typography.entryStyle.scope.object") }),
    ).toBeNull();
    expect(
      screen.getByRole("radio", { name: t("typography.fieldStyle.target.value") }),
    ).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: t("typography.fieldStyle.target.label") }),
    ).toBeTruthy();
  });

  it("改字段值写 meta，改字段名写 field_label，都不碰 objects", async () => {
    const onChange = renderPanel({
      objectId: HEADER_PATH,
      headerField: { id: HEADER_ID, label: "13800000000" },
      pickedPath: HEADER_PATH,
      defaultScope: "field",
      fieldRole: "meta",
      entry: null,
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: t("typography.row.increaseAria", { label: t("typography.prop.font_scale") }),
      }),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    let domains = readStyleDomains(lastLayout(onChange).format_config);
    expect(domains.objectRoles[`${HEADER_PATH}:meta`]).toMatchObject({ font_scale: 1.02 });
    expect(domains.objects[HEADER_PATH]).toBeUndefined();

    fireEvent.click(screen.getByRole("radio", { name: t("typography.fieldStyle.target.label") }));
    await waitFor(() => expect(screen.getByTestId("style-row-object-font_scale")).toBeTruthy());
    fireEvent.click(
      screen.getByRole("button", {
        name: t("typography.row.increaseAria", { label: t("typography.prop.font_scale") }),
      }),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    domains = readStyleDomains(lastLayout(onChange).format_config);
    expect(domains.objectRoles[`${HEADER_PATH}:field_label`]).toHaveProperty("font_scale");
  });

  it("没有标签段的字段禁用「字段名」，并给出可操作说明", () => {
    renderPanel({
      objectId: HEADER_PATH,
      headerField: { id: HEADER_ID, label: "139 0176 4428", hasLabel: false },
      pickedPath: HEADER_PATH,
      defaultScope: "field",
      fieldRole: "meta",
      entry: null,
    });
    expect(screen.getByText(t("typography.headerStyle.noLabel"))).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: t("typography.fieldStyle.target.label") }),
    ).toBeDisabled();
  });

  it("页眉字段不出现「日期位置」（没有条目头 flex 容器）", () => {
    renderPanel({
      objectId: HEADER_PATH,
      headerField: { id: HEADER_ID, label: "13800000000" },
      pickedPath: HEADER_PATH,
      defaultScope: "field",
      fieldRole: "meta",
      entry: null,
    });
    expect(screen.queryByTestId("style-row-object-meta_align")).toBeNull();
  });
});

describe("ObjectStylePanel · 单字段（I-28）", () => {
  it("字段作用域下可切换「字段值 / 字段名」，两者行清单不同", async () => {
    renderPanel({ defaultScope: "field", pickedPath: "exp_12345678.ob_item0002", lockScope: true });

    // 默认是字段值：正文类属性（缩进）在清单里。
    expect(screen.getByTestId("style-row-object-indent")).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: t("typography.fieldStyle.target.value") }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: t("typography.fieldStyle.target.label") }));

    // 切到字段名：角色变 field_label（只有字号/颜色/加粗/字距），缩进必须消失。
    await waitFor(() => expect(screen.queryByTestId("style-row-object-indent")).toBeNull());
    expect(screen.getByTestId("style-row-object-font_scale")).toBeTruthy();
  });

  it("非字段作用域不出现这个切换", () => {
    renderPanel({ defaultScope: "body" });
    expect(
      screen.queryByRole("radio", { name: t("typography.fieldStyle.target.label") }),
    ).toBeNull();
  });
});

describe("ObjectStylePanel · 字段作用域的落点（DF-8）", () => {
  it("正文字段：缩进 / 项目符号留在清单里（草稿已有 li / p 落点）", () => {
    renderPanel({
      defaultScope: "field",
      pickedPath: `${OBJECT_ID}.ob_item0003`,
      lockScope: true,
    });
    expect(document.querySelector(rowTestId("indent"))).not.toBeNull();
    expect(document.querySelector(rowTestId("bullet"))).not.toBeNull();
  });

  it("灰字字段：字段层没有条目头容器，「日期位置」不出现（即使条目里真有灰字）", () => {
    renderPanel({
      defaultScope: "field",
      fieldRole: "meta",
      pickedPath: `${OBJECT_ID}.ob_item0002`,
      lockScope: true,
    });
    // entry 里有 placement=meta 的字段（hasMeta=true），隐藏它的不是可用性判断而是属性清单。
    expect(document.querySelector(rowTestId("meta_align"))).toBeNull();
    expect(document.querySelector(rowTestId("color"))).not.toBeNull();
  });

  it("字段缩进写到该字段路径的 object_roles，不碰条目 objects", async () => {
    const fieldPath = `projects.${OBJECT_ID}.ob_item0003`;
    const onChange = renderPanel({
      objectId: fieldPath,
      defaultScope: "field",
      pickedPath: fieldPath,
      lockScope: true,
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: t("typography.row.increaseAria", { label: t("typography.prop.indent") }),
      }),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const domains = readStyleDomains(lastLayout(onChange).format_config);
    expect(domains.objectRoles[`${fieldPath}:body`]).toMatchObject({ indent: expect.any(Number) });
    expect(domains.objects[fieldPath]).toBeUndefined();
    expect(domains.objects[OBJECT_ID]).toBeUndefined();
  });
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
