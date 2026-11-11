// SPDX-License-Identifier: Apache-2.0
/** RelatedKnowledgeBlock (#29D): company/job query, render list, hide when zero, hide on error. */
import { App as AntdApp } from "antd";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";

const request = vi.fn();
vi.mock("../../api/client", () => ({
  request: (...args: unknown[]) => request(...args),
}));

import RelatedKnowledgeBlock from "./RelatedKnowledgeBlock";

const RESPONSE = {
  total: 2,
  items: [
    { id: 1, title: "Entry A", category: "custom-cat" },
    { id: 2, title: "Entry B", category: "" },
  ],
};

function renderBlock(company = "Acme", jobId = 7) {
  return render(
    <AntdApp>
      <MemoryRouter>
        <RelatedKnowledgeBlock company={company} jobId={jobId} />
      </MemoryRouter>
    </AntdApp>,
  );
}

beforeEach(() => {
  request.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("RelatedKnowledgeBlock", () => {
  it("queries by company and renders the related entries", async () => {
    request.mockResolvedValue(RESPONSE);
    renderBlock();
    expect(await screen.findByTestId("job-detail-related-knowledge")).toBeTruthy();
    expect(request).toHaveBeenCalledWith(expect.stringContaining("company=Acme"));
    expect(request).toHaveBeenCalledWith(expect.stringContaining("limit=5"));
    expect(screen.getByText(t("jobDetail.relatedKnowledge.title", { count: 2 }))).toBeTruthy();
    expect(screen.getByRole("link", { name: "Entry A" })).toHaveAttribute(
      "href",
      `/knowledge?q=${encodeURIComponent("Entry A")}`,
    );
    // Unknown custom category falls back to the raw value (custom categories stay editable).
    expect(screen.getByText(/custom-cat/)).toBeTruthy();
  });

  it("falls back to job_id when the job has no company", async () => {
    request.mockResolvedValue(RESPONSE);
    renderBlock("  ", 9);
    await screen.findByTestId("job-detail-related-knowledge");
    expect(request).toHaveBeenCalledWith(expect.stringContaining("job_id=9"));
  });

  it("renders nothing when there is no related knowledge", async () => {
    request.mockResolvedValue({ total: 0, items: [] });
    renderBlock();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("job-detail-related-knowledge")).toBeNull();
  });

  it("hides the block when the query fails (auxiliary info must not break the detail)", async () => {
    request.mockRejectedValue(new Error("boom"));
    renderBlock();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("job-detail-related-knowledge")).toBeNull();
  });
});
