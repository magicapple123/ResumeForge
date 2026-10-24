// SPDX-License-Identifier: Apache-2.0
/** 外发预览：字段展示、密钥标记、截断提示、确认入口，以及**不写本地存储**。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pt } from "../../../features/resume-provenance/i18n";
import type { OutboundPreviewOut } from "../../../features/resume-provenance/types";
import OutboundPreviewCard from "./OutboundPreviewCard";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

const PREVIEW: OutboundPreviewOut = {
  target_service: "assistant-provider",
  material_categories: ["resume"],
  attachment_types: ["pdf"],
  excluded_fields: ["phone"],
  fetch_pages: false,
  body_preview: "You are a helpful assistant. Resume: ...",
  body_chars: 120,
  body_truncated: false,
  body_sha256: "abc",
  secret_leak_detected: false,
  persistence: "memory_only",
};

describe("OutboundPreviewCard", () => {
  it("展示目标服务/资料类别/排除字段/是否抓取正文", () => {
    render(
      <AntdApp>
        <OutboundPreviewCard preview={PREVIEW} />
      </AntdApp>,
    );
    expect(screen.getByText("assistant-provider")).toBeTruthy();
    expect(screen.getByText("resume")).toBeTruthy();
    expect(screen.getByText("pdf")).toBeTruthy();
    expect(screen.getByText("phone")).toBeTruthy();
    expect(screen.getByText(pt("provenance.outbound.fetchPages.no"))).toBeTruthy();
    expect(screen.getByText(PREVIEW.body_preview)).toBeTruthy();
  });

  it("正文不写 localStorage / sessionStorage（含确认点击后）", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(
      <AntdApp>
        <OutboundPreviewCard preview={PREVIEW} onConfirm={vi.fn()} />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.outbound.confirm") }));
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("截断与疑似密钥各有明确提示", () => {
    render(
      <AntdApp>
        <OutboundPreviewCard
          preview={{ ...PREVIEW, body_truncated: true, secret_leak_detected: true }}
        />
      </AntdApp>,
    );
    expect(screen.getByText(pt("provenance.outbound.truncated"))).toBeTruthy();
    expect(screen.getByText(pt("provenance.outbound.secretLeak"))).toBeTruthy();
  });

  it("确认按钮只在宿主提供回调时出现", () => {
    render(
      <AntdApp>
        <OutboundPreviewCard preview={PREVIEW} />
      </AntdApp>,
    );
    expect(screen.queryByRole("button", { name: pt("provenance.outbound.confirm") })).toBeNull();
  });
});
