// SPDX-License-Identifier: Apache-2.0
/** A3：从资料箱显式选入——只生成编辑器草稿，不直接创建事实。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import MaterialPickView, { defaultKindForCategory, materialToDraft } from "./MaterialPickView";

const api = vi.hoisted(() => ({ listMaterials: vi.fn() }));

vi.mock("../../api/material", () => ({ listMaterials: api.listMaterials }));

const MATERIAL = {
  id: 3,
  title: "示例项目管理证书",
  category: "证书",
  content: "2024 年取得项目管理培训证书。",
  url: "https://example.com/cert",
  note: "",
  files: [],
  created_at: "2026-10-01T10:00:00",
  updated_at: "2026-10-01T10:00:00",
};

beforeEach(() => {
  api.listMaterials.mockResolvedValue([MATERIAL]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("资料箱选入", () => {
  it("分类映射为默认事实类型，且草稿只使用资料里的真实字段", () => {
    expect(defaultKindForCategory("证书")).toBe("credential");
    expect(defaultKindForCategory("作品")).toBe("work_project");
    expect(defaultKindForCategory("未知分类")).toBe("practice");

    const draft = materialToDraft(MATERIAL, "credential");
    expect(draft).toMatchObject({
      name: "示例项目管理证书",
      status: "unknown",
      verify_url: "https://example.com/cert",
      note: "2024 年取得项目管理培训证书。",
    });
    // 证号是私密字段：草稿保持空串，不把资料内容猜成证号。
    expect((draft as { credential_number?: string }).credential_number).toBe("");
  });

  it("选择资料后点「选入并填写」只回调草稿，不调用创建接口", async () => {
    const onPick = vi.fn();
    render(
      <AntdApp>
        <MaterialPickView onPick={onPick} onCancel={vi.fn()} />
      </AntdApp>,
    );
    await waitFor(() => expect(api.listMaterials).toHaveBeenCalled());
    fireEvent.mouseDown(screen.getAllByRole("combobox")[0]);
    // i18n-ok: 断言固定的演示资料标题
    fireEvent.click(await screen.findByText("示例项目管理证书 · 证书"));
    fireEvent.click(screen.getByRole("button", { name: t("profileFacts.material.confirm") }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(
      "credential",
      expect.objectContaining({ name: "示例项目管理证书" }),
    );
  });

  it("没有选资料时确认按钮禁用", async () => {
    render(
      <AntdApp>
        <MaterialPickView onPick={vi.fn()} onCancel={vi.fn()} />
      </AntdApp>,
    );
    await waitFor(() => expect(api.listMaterials).toHaveBeenCalled());
    const confirm = screen.getByRole("button", { name: t("profileFacts.material.confirm") });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });
});
