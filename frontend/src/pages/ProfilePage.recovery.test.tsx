import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupProfilePage,
  DEFAULT_PROFILE,
  renderProfilePage,
  resetProfileApiMocks,
} from "../test/profilePageHarness";
import { TEMPLATE_CATALOG } from "../test/resumeFixtures";
import { getProfileEditControl } from "../features/tou-tou/profileSaveBridge";

const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  saveProfile: vi.fn(),
  listResumes: vi.fn(),
  getWebFormExtraProfile: vi.fn(),
  updateWebFormExtraProfile: vi.fn(),
}));
vi.mock("../api/profile", () => ({ getProfile: mocks.getProfile, saveProfile: mocks.saveProfile }));
vi.mock("../api/webform", async (original) => ({
  ...(await original<typeof import("../api/webform")>()),
  getWebFormExtraProfile: mocks.getWebFormExtraProfile,
  updateWebFormExtraProfile: mocks.updateWebFormExtraProfile,
}));
vi.mock("../api/resumes", async (original) => ({
  ...(await original<typeof import("../api/resumes")>()),
  listResumes: mocks.listResumes,
  fetchResumeTemplates: vi.fn(async () => TEMPLATE_CATALOG),
}));
vi.mock("../api/settings", () => ({ getLLMConfig: vi.fn().mockResolvedValue({}) }));

beforeEach(() => resetProfileApiMocks(mocks));
afterEach(cleanupProfilePage);

describe("profile read recovery", () => {
  it("does not expose a blank editor after a failed read and reloads the saved profile on retry", async () => {
    mocks.getProfile.mockRejectedValueOnce(new Error("原始资料读取失败"));
    renderProfilePage();
    const retry = await screen.findByRole("button", { name: /重\s*试/ });
    expect(retry.closest('[role="alert"]')).toHaveTextContent("原始资料读取失败");
    expect(screen.queryByRole("heading", { name: "我的资料" })).toBeNull();
    expect(mocks.saveProfile).not.toHaveBeenCalled();
    expect(getProfileEditControl()).toBeNull();
    fireEvent.click(retry);
    expect(await screen.findByDisplayValue(DEFAULT_PROFILE.name)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "我的资料" })).toBeInTheDocument();
    expect(mocks.saveProfile).not.toHaveBeenCalled();
  });
});
