// SPDX-License-Identifier: Apache-2.0
/**
 * Q18: if the embedded PDF viewer never fires onLoad, the panel must fall back to the
 * "open in a new tab" state after 8s instead of leaving a blank frame.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import ExactPreviewPanel from "./ExactPreviewPanel";
import { clearPreviewCache } from "./exactPreviewCache";

const fetchPreview = vi.hoisted(() => vi.fn());

vi.mock("../../api/resumes", () => ({
  fetchResumePreviewPdf: fetchPreview,
}));

function panel() {
  return (
    <ExactPreviewPanel
      resumeId={7}
      template="classic"
      formatName=""
      pageLimit={1}
      fontScale="standard"
      formatConfig={{ page_padding: 14 }}
      contentSignature="c1"
      height={600}
    />
  );
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  clearPreviewCache();
  fetchPreview.mockReset().mockResolvedValue({
    blob: new Blob(["%PDF-1.3"], { type: "application/pdf" }),
    pages: 1,
    pagesNeeded: 1,
    pageLimit: 1,
    overflow: false,
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:fallback-preview",
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => undefined });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ExactPreviewPanel frame load fallback", () => {
  it("falls back to the new-tab hint when the viewer never loads within 8s", async () => {
    render(panel());
    // 150ms request debounce, then the PDF result arrives.
    await advance(200);
    expect(screen.getByTitle(t("preview.exact.frameTitle"))).toBeTruthy();
    expect(screen.queryByText(t("preview.exact.loadTimeoutTitle"))).toBeNull();

    await advance(8100);
    expect(screen.getByText(t("preview.exact.loadTimeoutTitle"))).toBeTruthy();
  });

  it("keeps the inline viewer when onLoad arrives before the deadline", async () => {
    render(panel());
    await advance(200);
    fireEvent.load(screen.getByTitle(t("preview.exact.frameTitle")));
    await advance(9000);

    expect(screen.queryByText(t("preview.exact.loadTimeoutTitle"))).toBeNull();
    expect(screen.getByTitle(t("preview.exact.frameTitle"))).toBeTruthy();
  });
});
