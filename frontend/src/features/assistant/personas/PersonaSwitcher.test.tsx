/**
 * 视角切换器（18C）：三个 preset + 通用；草稿禁用；切换保存并通知刷新技能；失败提示。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import PersonaSwitcher from "./PersonaSwitcher";

const apiMocks = vi.hoisted(() => ({
  readConversationPersona: vi.fn(),
  saveConversationPersona: vi.fn(),
}));

vi.mock("./personaApi", async () => {
  const actual = await vi.importActual<typeof import("./personaApi")>("./personaApi");
  return {
    ...actual,
    readConversationPersona: apiMocks.readConversationPersona,
    saveConversationPersona: apiMocks.saveConversationPersona,
  };
});

function renderSwitcher(conversationId: number | null, onChanged = vi.fn()) {
  render(
    <AntdApp>
      <PersonaSwitcher conversationId={conversationId} onChanged={onChanged} />
    </AntdApp>,
  );
  return { onChanged };
}

afterEach(() => cleanup());
beforeEach(() => {
  apiMocks.readConversationPersona.mockReset();
  apiMocks.saveConversationPersona.mockReset();
  apiMocks.readConversationPersona.mockResolvedValue({ persona_id: "" });
  apiMocks.saveConversationPersona.mockResolvedValue({ persona_id: "interviewer" });
});

describe("PersonaSwitcher", () => {
  it("lists the general option plus three presets", async () => {
    renderSwitcher(7);
    await waitFor(() => expect(apiMocks.readConversationPersona).toHaveBeenCalledWith(7));

    for (const key of [
      "assistantBreadth.persona.default",
      "assistantBreadth.persona.hr_scan",
      "assistantBreadth.persona.interviewer",
      "assistantBreadth.persona.headhunter",
    ] as const) {
      expect(screen.getByText(t(key))).toBeTruthy();
    }
  });

  it("saves the selected preset and refreshes the skill chips", async () => {
    const { onChanged } = renderSwitcher(7);
    await waitFor(() => expect(apiMocks.readConversationPersona).toHaveBeenCalled());

    fireEvent.click(screen.getByText(t("assistantBreadth.persona.interviewer")));
    await waitFor(() =>
      expect(apiMocks.saveConversationPersona).toHaveBeenCalledWith(7, "interviewer"),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("is disabled before a conversation exists and never asks the API", () => {
    renderSwitcher(null);
    expect(apiMocks.readConversationPersona).not.toHaveBeenCalled();
    expect(screen.getByText(t("assistantBreadth.persona.label"))).toBeTruthy();
  });

  it("surfaces a switch failure without pretending it succeeded", async () => {
    apiMocks.saveConversationPersona.mockRejectedValue(new Error("boom"));
    renderSwitcher(7);
    await waitFor(() => expect(apiMocks.readConversationPersona).toHaveBeenCalled());

    fireEvent.click(screen.getByText(t("assistantBreadth.persona.headhunter")));
    await waitFor(() => expect(screen.getByText(t("assistantBreadth.persona.error"))).toBeTruthy());
  });
});
