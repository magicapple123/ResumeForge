// SPDX-License-Identifier: Apache-2.0
/**
 * 「模型窗口参考」弹层：表要能打开、数字要能逐位核对、当前模型要标出来。
 *
 * 为什么单独测：这张表是用户手填窗口的唯一参照——数字被四舍五入、链接点不开、或者
 * "当前"标错行，都会让人把窗口填错（填大直接 400）。加载失败也必须给出重试，而不是
 * 留一个空弹层。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({ getModelWindowReference: vi.fn() }));
vi.mock("../../api/settings", () => apiMocks);

import ModelWindowReferenceButton from "./ModelWindowReferenceButton";
import { t } from "../../i18n";
import type { ModelWindowReference } from "../../types";

afterEach(() => {
  cleanup();
});

const DATA: ModelWindowReference = {
  default_tokens: 128_000,
  entries: [
    { label: "GPT-4.1", tokens: 1_047_576, reference: "https://example.com/gpt-4.1" },
    { label: "GPT-4o", tokens: 128_000, reference: "https://example.com/gpt-4o" },
  ],
  current: { model: "gpt-4o-2024", label: "GPT-4o", tokens: 128_000, source: "reference" },
};

function renderButton() {
  return render(
    <AntdApp>
      <ModelWindowReferenceButton />
    </AntdApp>,
  );
}

describe("ModelWindowReferenceButton", () => {
  it("打开后按原值列出窗口，并只给当前模型打标", async () => {
    apiMocks.getModelWindowReference.mockResolvedValue(DATA);
    renderButton();

    fireEvent.click(
      screen.getByRole("button", { name: t("contextUsage.window.reference.trigger") }),
    );
    expect(await screen.findByText("GPT-4.1")).toBeInTheDocument();

    // 参考表不缩写：1,047,576 要能逐位核对（1.0M 会抹掉精度）。
    expect(screen.getByText("1,047,576")).toBeInTheDocument();
    // 只有当前模型那一行有「当前」，不是第一行也不是全部。
    expect(screen.getAllByText(t("contextUsage.window.reference.currentBadge"))).toHaveLength(1);
    const currentRow = screen.getByText("GPT-4o").closest("tr");
    expect(currentRow?.textContent).toContain(t("contextUsage.window.reference.currentBadge"));
  });

  it("官方文档在新窗口打开", async () => {
    apiMocks.getModelWindowReference.mockResolvedValue(DATA);
    renderButton();
    fireEvent.click(
      screen.getByRole("button", { name: t("contextUsage.window.reference.trigger") }),
    );
    const row = (await screen.findByText("GPT-4.1")).closest("tr");
    const link = within(row as HTMLElement).getByRole("link", {
      name: t("contextUsage.window.reference.open"),
    });
    expect(link).toHaveAttribute("href", "https://example.com/gpt-4.1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("加载失败给可重试的提示，重试成功后表格出现", async () => {
    apiMocks.getModelWindowReference
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(DATA);
    renderButton();

    fireEvent.click(
      screen.getByRole("button", { name: t("contextUsage.window.reference.trigger") }),
    );
    expect(await screen.findByText(t("contextUsage.window.reference.failed"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
    await waitFor(() => expect(screen.getByText("GPT-4.1")).toBeInTheDocument());
    expect(apiMocks.getModelWindowReference).toHaveBeenCalledTimes(2);
  });

  it("只打开一次只请求一次（表是常量，不随弹层重开刷新）", async () => {
    apiMocks.getModelWindowReference.mockResolvedValue(DATA);
    renderButton();
    const trigger = screen.getByRole("button", {
      name: t("contextUsage.window.reference.trigger"),
    });
    fireEvent.click(trigger);
    await screen.findByText("GPT-4.1");
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(trigger);
    await screen.findByText("GPT-4.1");
    expect(apiMocks.getModelWindowReference).toHaveBeenCalledTimes(1);
  });
});
