// SPDX-License-Identifier: Apache-2.0
/**
 * 语音配置弹窗：新建/编辑/复制、预设回填、名称校验（必填/重名）、Key 三档口径提示、
 * 测试连接与结果就地显示。
 *
 * 只 mock 掉 `fetchAsrModels`（真正的 HTTP 由后端用例守），其余 API 常量与纯函数用真值。
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App as AntdApp } from "antd";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import AsrProfileModal from "./AsrProfileModal";
import { buttonByLabel, makeAsrProfile } from "../../test/asrTestHelpers";

const apiMocks = vi.hoisted(() => ({ fetchAsrModels: vi.fn() }));

vi.mock("./asrApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./asrApi")>();
  return { ...actual, fetchAsrModels: apiMocks.fetchAsrModels };
});

const DASHSCOPE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

type Props = ComponentProps<typeof AsrProfileModal>;

function renderModal(overrides: Partial<Props> = {}) {
  const props: Props = {
    open: true,
    mode: "create",
    source: null,
    activeId: "",
    takenNames: [],
    saving: false,
    testing: false,
    testResult: null,
    onSave: vi.fn().mockResolvedValue(undefined),
    onTest: vi.fn().mockResolvedValue({ ok: true, latency_ms: 10, message: "ok" }),
    onClose: vi.fn(),
    ...overrides,
  };
  render(
    <AntdApp>
      <AsrProfileModal {...props} />
    </AntdApp>,
  );
  return props;
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

function saveButton(): HTMLElement {
  return buttonByLabel(t("voiceInput.settings.modal.save"));
}

function nameInput(): HTMLElement {
  return within(dialog()).getByLabelText(t("voiceInput.settings.modal.name.label"));
}

function presetGrid(): HTMLElement {
  return within(dialog()).getByRole("radiogroup", {
    name: t("voiceInput.settings.provider.aria"),
  });
}

beforeEach(() => {
  apiMocks.fetchAsrModels.mockReset().mockResolvedValue({ models: [] });
});

describe("AsrProfileModal", () => {
  it("新建：选预设自动填地址/协议/模型，保存时不带 id", async () => {
    const props = renderModal();

    expect(
      within(dialog()).getByText(t("voiceInput.settings.modal.createTitle")),
    ).toBeInTheDocument();
    fireEvent.click(
      within(presetGrid()).getByRole("radio", {
        name: t("voiceInput.settings.provider.dashscope"),
      }),
    );
    expect(within(dialog()).getByLabelText(t("voiceInput.settings.baseUrl.aria"))).toHaveValue(
      DASHSCOPE_URL,
    );
    expect(within(dialog()).getByLabelText(t("voiceInput.settings.model.aria"))).toHaveValue(
      "qwen3-asr-flash",
    );

    fireEvent.change(nameInput(), { target: { value: "公司百炼" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
    expect(props.onSave).toHaveBeenCalledWith({
      id: undefined,
      name: "公司百炼",
      preset_id: "dashscope",
      base_url: DASHSCOPE_URL,
      model: "qwen3-asr-flash",
      protocol: "dashscope",
      api_key: "",
    });
  });

  it("名称必填：留空点保存就地报错，且不发请求", () => {
    const props = renderModal();

    fireEvent.click(saveButton());

    expect(screen.getByText(t("voiceInput.settings.validation.nameRequired"))).toBeInTheDocument();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("重名：本地就拦下并说明原因", () => {
    const props = renderModal({ takenNames: ["重名配置"] });

    fireEvent.change(nameInput(), { target: { value: "重名配置" } });
    fireEvent.click(saveButton());

    expect(screen.getByText(t("voiceInput.settings.validation.nameConflict"))).toBeInTheDocument();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("编辑生效项：回显名称、提示保存后立即生效；改地址时提前说明会清 Key", async () => {
    const source = makeAsrProfile();
    const props = renderModal({ mode: "edit", source, activeId: source.id });

    expect(
      within(dialog()).getByText(t("voiceInput.settings.modal.editTitle")),
    ).toBeInTheDocument();
    expect(nameInput()).toHaveValue(source.name);
    expect(
      within(dialog()).getByText(t("voiceInput.settings.modal.activeHint")),
    ).toBeInTheDocument();
    expect(within(dialog()).getByText(t("voiceInput.settings.key.keepHint"))).toBeInTheDocument();

    fireEvent.change(within(dialog()).getByLabelText(t("voiceInput.settings.baseUrl.aria")), {
      target: { value: "https://api.siliconflow.cn/v1" },
    });
    expect(within(dialog()).getByText(t("voiceInput.settings.key.willClear"))).toBeInTheDocument();

    fireEvent.click(saveButton());
    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: source.id,
        // 留空表示保留本条旧 Key；地址变了由服务端清空。
        api_key: "",
        base_url: "https://api.siliconflow.cn/v1",
      }),
    );
  });

  it("复制：名称带副本后缀，Key 提示按新建口径（不继承）", () => {
    const source = makeAsrProfile();
    renderModal({ mode: "create", source });

    expect(nameInput()).toHaveValue(source.name + t("voiceInput.settings.profile.duplicateSuffix"));
    expect(within(dialog()).getByText(t("voiceInput.settings.key.createHint"))).toBeInTheDocument();
    expect(
      within(dialog()).getByText(t("voiceInput.settings.modal.duplicateHint")),
    ).toBeInTheDocument();
  });

  it("测试连接：把草稿值发给回调，结果就地显示", async () => {
    const props = renderModal();

    fireEvent.click(buttonByLabel(t("voiceInput.settings.test")));
    await waitFor(() => expect(props.onTest).toHaveBeenCalledTimes(1));
    expect(props.onTest).toHaveBeenCalledWith({
      base_url: "",
      model: "",
      protocol: "openai",
      api_key: "",
    });
  });

  it("测试结果成功时显示耗时", () => {
    renderModal({ testResult: { ok: true, latency_ms: 88, message: "ok" } });

    expect(
      within(dialog()).getByText(t("voiceInput.settings.testOk", { ms: 88 })),
    ).toBeInTheDocument();
  });

  it("保存失败：把服务端原因原样显示在弹窗里", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("duplicate profile name"));
    renderModal({ onSave });

    fireEvent.change(nameInput(), { target: { value: "Work Groq" } });
    fireEvent.click(saveButton());

    expect(await screen.findByText(/duplicate profile name/)).toBeInTheDocument();
  });
});
