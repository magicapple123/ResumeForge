// SPDX-License-Identifier: Apache-2.0
/**
 * 字段设置视图（契约 §2-4）：隐藏默认字段、自定义字段增删、恢复默认、
 * 版本冲突 409 的刷新语义。视图只接回调，不直接发请求。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import { t } from "../../i18n";
import FieldSettingsView from "./FieldSettingsView";
import { makeKindSchema, makeSchema, makeSchemaMap } from "./testFixtures";
import type { FactKind, ProfileFactKindSchemaUpdate } from "./types";

afterEach(() => {
  cleanup();
});

function renderView(overrides: Partial<React.ComponentProps<typeof FieldSettingsView>> = {}) {
  const onSave = vi.fn().mockResolvedValue(makeKindSchema("publication"));
  const onReset = vi.fn().mockResolvedValue(makeKindSchema("publication", { revision: 2 }));
  const onRefresh = vi.fn().mockResolvedValue(makeSchema());
  const props: React.ComponentProps<typeof FieldSettingsView> = {
    kindSchemas: makeSchemaMap(),
    onSave,
    onReset,
    onRefresh,
    onBack: vi.fn(),
    ...overrides,
  };
  render(
    <AntdApp>
      <FieldSettingsView {...props} />
    </AntdApp>,
  );
  return { onSave, onReset, onRefresh };
}

function saveButton() {
  return screen.getByRole("button", { name: t("profileFacts.settings.save") });
}

describe("字段设置：隐藏默认字段", () => {
  it("取消勾选后保存 hidden_fields，并带上当前 revision", async () => {
    const { onSave } = renderView();
    // 从未保存过的类型显示「默认设置」而不是「修订 0」。
    expect(screen.getByText(t("profileFacts.settings.revisionDefault"))).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: t("research.publications.year") })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: t("research.publications.year") }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [kind, input] = onSave.mock.calls[0] as [FactKind, ProfileFactKindSchemaUpdate];
    expect(kind).toBe("publication");
    // 后端"缺失 prefs 行"时 GET 返回 revision 0；首次保存就用 0 作为条件写前提。
    expect(input.expected_revision).toBe(0);
    expect(input.hidden_fields).toEqual(["year"]);
    expect(input.custom_fields).toEqual([]);
  });
});

describe("字段设置：自定义字段", () => {
  it("添加一行并保存时省略 key（由服务端生成）", async () => {
    const { onSave } = renderView();
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("profileFacts.settings.addCustom")) }),
    );
    fireEvent.change(screen.getByLabelText(t("profileFacts.settings.customAria", { index: 1 })), {
      target: { value: "Team size" },
    });
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [, input] = onSave.mock.calls[0] as [FactKind, ProfileFactKindSchemaUpdate];
    expect(input.custom_fields).toEqual([{ label: "Team size" }]);
  });

  it("删除一行后保存，只提交剩下的定义", async () => {
    const { onSave } = renderView();
    const addCustom = screen.getByRole("button", {
      name: new RegExp(t("profileFacts.settings.addCustom")),
    });
    fireEvent.click(addCustom);
    fireEvent.click(addCustom);
    const first = screen.getByLabelText(t("profileFacts.settings.customAria", { index: 1 }));
    const second = screen.getByLabelText(t("profileFacts.settings.customAria", { index: 2 }));
    fireEvent.change(first, { target: { value: "Scope" } });
    fireEvent.change(second, { target: { value: "Keep me" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: t("profileFacts.settings.removeCustomAria", { label: "Scope" }),
      }),
    );
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [, input] = onSave.mock.calls[0] as [FactKind, ProfileFactKindSchemaUpdate];
    expect(input.custom_fields).toEqual([{ label: "Keep me" }]);
  });

  it("重名/空名在保存前拦下，不发请求", async () => {
    const { onSave } = renderView();
    const addCustom = screen.getByRole("button", {
      name: new RegExp(t("profileFacts.settings.addCustom")),
    });
    fireEvent.click(addCustom);
    fireEvent.click(addCustom);
    const first = screen.getByLabelText(t("profileFacts.settings.customAria", { index: 1 }));
    const second = screen.getByLabelText(t("profileFacts.settings.customAria", { index: 2 }));
    fireEvent.change(first, { target: { value: "Scope" } });
    fireEvent.change(second, { target: { value: " Scope " } });
    fireEvent.click(saveButton());
    expect(
      await screen.findByText(t("profileFacts.settings.inputDuplicate", { label: "Scope" })),
    ).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("字段设置：恢复默认", () => {
  it("先内联确认，确认后调用 reset（带 expected_revision）", async () => {
    const { onReset } = renderView();
    fireEvent.click(screen.getByRole("button", { name: t("profileFacts.settings.reset") }));
    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText(
        t("profileFacts.settings.resetConfirmTitle", {
          label: t("profileFacts.kind.publication"),
        }),
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      within(alert).getByRole("button", { name: t("profileFacts.settings.resetConfirm") }),
    );
    await waitFor(() => expect(onReset).toHaveBeenCalledWith("publication", 0));
    // 服务端返回 revision 2 后，修订号标签跟着更新。
    expect(
      await screen.findByText(t("profileFacts.settings.revision", { revision: 2 })),
    ).toBeInTheDocument();
  });
});

describe("字段设置：409 冲突", () => {
  it("提示刷新；刷新成功后冲突提示消失", async () => {
    const { onSave, onRefresh } = renderView();
    onSave.mockRejectedValue(
      new ApiError("conflict", 409, { businessCode: "profile_fact_schema_revision_conflict" }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: t("research.publications.year") }));
    fireEvent.click(saveButton());
    expect(
      await screen.findByText(
        t("profileFacts.settings.conflict", { label: t("profileFacts.kind.publication") }),
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /刷\s*新/ }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.queryByText(
          t("profileFacts.settings.conflict", { label: t("profileFacts.kind.publication") }),
        ),
      ).not.toBeInTheDocument(),
    );
  });
});

describe("字段设置：切换类型", () => {
  it("切换事实类型后展示该类型的默认字段", async () => {
    renderView();
    fireEvent.mouseDown(screen.getByLabelText(t("profileFacts.settings.kind")));
    fireEvent.click(await screen.findByText(t("profileFacts.kind.training")));
    expect(
      await screen.findByRole("checkbox", { name: t("profileFacts.training.hours") }),
    ).toBeInTheDocument();
  });
});
