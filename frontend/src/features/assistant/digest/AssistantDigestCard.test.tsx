/**
 * 今日简报卡（18B）：只读展示、板块条件渲染、重新生成与失败提示。
 *
 * 断言文案一律走 t(...)，不写在测试里（cjkRatchet 的 tests 口径）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import AssistantDigestCard from "./AssistantDigestCard";

const refresh = vi.fn();
const reload = vi.fn();
const controller = {
  digest: null as unknown,
  loading: false,
  refreshing: false,
  failed: false,
  reload,
  refresh,
};

vi.mock("./useAssistantDigest", () => ({
  useAssistantDigest: () => controller,
}));

const SAMPLE = {
  generated_at: "2026-11-11T08:00:00+08:00",
  refresh_hours: 24,
  changes: { count: 2, jd_changed: 1, stale: 1 },
  sections: [
    {
      key: "worth_jobs",
      count: 1,
      items: [{ job_id: 3, title: "Backend Intern", company: "Example Inc", score: 86 }],
      disclaimer: "local estimate only",
    },
    {
      key: "stale_applications",
      count: 1,
      items: [{ record_id: 5, job_id: 4, title: "Data Intern", company: "Old Co", days: 9 }],
    },
    {
      key: "interviews",
      count: 1,
      today_count: 1,
      items: [
        {
          track_id: 7,
          title: "Backend Intern",
          company: "Example Inc",
          days_until: 0,
          next_action: "Tech round 2",
          next_action_date: "2026-11-11",
        },
      ],
    },
    { key: "expired_jobs", count: 0, items: [] },
    {
      key: "funnel",
      count: 2,
      summary: { applied: 2, succeeded: 1, failed: 1, interviewing: 1 },
    },
  ],
};

function renderCard() {
  render(
    <AntdApp>
      <AssistantDigestCard />
    </AntdApp>,
  );
}

afterEach(() => {
  cleanup();
  refresh.mockReset();
  controller.digest = null;
  controller.loading = false;
  controller.refreshing = false;
  controller.failed = false;
});

describe("AssistantDigestCard", () => {
  it("renders sections with concrete items and the update time", () => {
    controller.digest = SAMPLE;
    renderCard();

    expect(screen.getByText(t("assistantBreadth.digest.title"))).toBeTruthy();
    expect(screen.getByText(t("assistantBreadth.digest.changes", { count: 2 }))).toBeTruthy();
    expect(screen.getByTestId("digest-generated-at").textContent).toContain("08:00");
    expect(screen.getByTestId("digest-section-worth_jobs").textContent).toContain(
      t("assistantBreadth.digest.score", { score: 86 }),
    );
    expect(screen.getByTestId("digest-section-stale_applications").textContent).toContain(
      t("assistantBreadth.digest.staleDays", { days: 9 }),
    );
    expect(screen.getByTestId("digest-section-interviews").textContent).toContain(
      t("assistantBreadth.digest.interviewToday", { count: 1 }),
    );
    expect(screen.getByTestId("digest-section-funnel").textContent).toContain(
      t("assistantBreadth.digest.funnel.interviewing", { count: 1 }),
    );
    // 空板块（expired_jobs=0）不渲染，避免一屏都是 0。
    expect(screen.queryByTestId("digest-section-expired_jobs")).toBeNull();
  });

  it("shows the refresh action and calls the force-refresh endpoint", async () => {
    controller.digest = SAMPLE;
    refresh.mockResolvedValue(undefined);
    renderCard();

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("assistantBreadth.digest.refresh")) }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("shows a readable error when loading failed", () => {
    controller.failed = true;
    controller.digest = null;
    renderCard();
    expect(screen.getByText(t("assistantBreadth.digest.error"))).toBeTruthy();
  });

  it("shows the empty state when only the funnel board has data", () => {
    controller.digest = {
      ...SAMPLE,
      changes: { count: 0, jd_changed: 0, stale: 0 },
      sections: [SAMPLE.sections[4]],
    };
    renderCard();
    expect(screen.getByText(t("assistantBreadth.digest.empty"))).toBeTruthy();
  });
});
