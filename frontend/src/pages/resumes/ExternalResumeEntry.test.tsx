// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心筛选栏的「外部简历 N」入口（第 1 条）。
 *
 * 三条性质：数量 > 0 时带数字、数量 = 0 时按钮仍在（只是没有数字）、
 * 点击去独立页。数量来自 `page_size: 1` 的 `total`，不是把列表拉全量再数。
 */
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import ExternalResumeEntry from "./ExternalResumeEntry";

const navigateMock = vi.hoisted(() => vi.fn());
const apiMocks = vi.hoisted(() => ({ listExternalResumes: vi.fn() }));

vi.mock("../../api/externalResumes", () => apiMocks);
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

function renderEntry() {
  return render(
    <MemoryRouter>
      <ExternalResumeEntry />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  navigateMock.mockReset();
  apiMocks.listExternalResumes.mockReset();
});

describe("ExternalResumeEntry", () => {
  it("有 5 份时按钮带数字，点击进入独立页", async () => {
    apiMocks.listExternalResumes.mockResolvedValue({ items: [], total: 5, page: 1, page_size: 1 });
    renderEntry();

    // 可访问名就是可见文本（不挂 aria-label：axe 的 label-content-name-mismatch 会红）。
    const button = await screen.findByRole("button", {
      name: t("resumesPage.external.entryWithCount", { count: 5 }),
    });
    // 只取计数：不把列表拉全量。
    expect(apiMocks.listExternalResumes).toHaveBeenCalledWith({ page_size: 1 });

    button.click();
    expect(navigateMock).toHaveBeenCalledWith("/resumes/external");
  });

  it("一份都没有时按钮仍在，只是不带数字（否则空态入口永远找不到）", async () => {
    apiMocks.listExternalResumes.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 1 });
    renderEntry();

    const button = await screen.findByRole("button", {
      name: t("resumesPage.external.entry"),
    });
    expect(button.textContent).not.toContain("0");

    await waitFor(() =>
      expect(apiMocks.listExternalResumes).toHaveBeenCalledWith({ page_size: 1 }),
    );
  });
});
