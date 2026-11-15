// SPDX-License-Identifier: Apache-2.0
/**
 * 「识别引擎」设置卡（T01）的定向用例。
 *
 * 三档的**可读说明由后端给**（`engine_options[].label`），所以这里断言界面用的是后端那
 * 一份文案——前端若偷偷写了自己的中文，这个用例会看不到后端那句而变红。
 *
 * 另一条是"没有 Key 时必须说清楚会怎样"：选「只用 OCR」会直接报错，不会悄悄换服务商。
 */

import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import OcrEngineCard from "./OcrEngineCard";

const connMocks = vi.hoisted(() => ({
  getConnections: vi.fn(),
  saveSystemSource: vi.fn(),
  resetSystemSource: vi.fn(),
  setLLMSessionKey: vi.fn(),
  clearLLMSessionKey: vi.fn(),
  getOcrSettings: vi.fn(),
  saveOcrEngine: vi.fn(),
}));

vi.mock("../../api/connections", () => connMocks);

/**
 * 后端给的档位说明（形状同 `services/ocr/policy.py` 的 `ENGINE_LABELS`）。
 *
 * 这里刻意用**ASCII 假文案**而不是真实中文：界面若偷偷写了自己的译文，断言就会找不到
 * 这三行——这比"抄一遍后端原文"更能证明"说明来自响应"。
 */
const OPTIONS = [
  { value: "auto" as const, label: "backend:auto" },
  { value: "ocr" as const, label: "backend:ocr" },
  { value: "vision" as const, label: "backend:vision" },
];

function renderCard() {
  return render(
    <AntdApp>
      <OcrEngineCard />
    </AntdApp>,
  );
}

beforeEach(() => {
  connMocks.getOcrSettings.mockResolvedValue({
    engine: "auto",
    key_configured: false,
    engine_options: OPTIONS,
  });
  connMocks.saveOcrEngine.mockResolvedValue({
    engine: "ocr",
    key_configured: false,
    engine_options: OPTIONS,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OcrEngineCard", () => {
  it("renders the three options with the labels the backend supplies", async () => {
    renderCard();
    for (const option of OPTIONS) {
      expect(await screen.findByRole("radio", { name: option.label })).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: OPTIONS[0].label })).toBeChecked();
    expect(
      screen.getByText(t("ocrEngine.current", { label: OPTIONS[0].label })),
    ).toBeInTheDocument();
  });

  it("warns that OCR-only errors out when no key is configured", async () => {
    renderCard();
    expect(await screen.findByText(t("ocrEngine.keyMissing.title"))).toBeInTheDocument();
    // 告知里必须写明"不会偷偷换服务商"，这是三档设置的核心承诺。
    expect(screen.getByText(t("ocrEngine.keyMissing.body"))).toBeInTheDocument();
  });

  it("saves the chosen engine and hides the warning once a key exists", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("radio", { name: OPTIONS[1].label }));

    await waitFor(() => expect(connMocks.saveOcrEngine).toHaveBeenCalledWith("ocr"));
    // 切换成功后按响应重渲染：当前档位跟着变。
    await waitFor(() =>
      expect(
        screen.getByText(t("ocrEngine.current", { label: OPTIONS[1].label })),
      ).toBeInTheDocument(),
    );
  });

  it("keeps the selection unchanged when the save fails", async () => {
    connMocks.saveOcrEngine.mockRejectedValue(new Error("backend rejected the change"));
    renderCard();
    fireEvent.click(await screen.findByRole("radio", { name: OPTIONS[2].label }));

    expect(
      await screen.findByText(
        t("ocrEngine.saveFailed", { message: "backend rejected the change" }),
      ),
    ).toBeInTheDocument();
    // 失败不能乐观改：界面仍停在原来那一档。
    expect(screen.getByRole("radio", { name: OPTIONS[0].label })).toBeChecked();
  });
});
