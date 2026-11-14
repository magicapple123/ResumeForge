/**
 * 今日简报卡（18B）：只读展示、板块条件渲染、重新生成与失败提示。
 *
 * 断言文案一律走 t(...)，不写在测试里（cjkRatchet 的 tests 口径）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import AssistantDigestCard from "./AssistantDigestCard";
import { DIGEST_EXPANDED_KEY } from "./useDigestDisclosure";

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
  const rendered = render(
    <AntdApp>
      <AssistantDigestCard />
    </AntdApp>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(t("assistantBreadth.digest.title")) }),
  );
  return rendered;
}

beforeEach(() => localStorage.setItem(DIGEST_EXPANDED_KEY, "false"));

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

    expect(
      screen.getByRole("button", { name: new RegExp(t("assistantBreadth.digest.title")) }),
    ).toBeTruthy();
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
    expect(document.querySelector(".assistant-digest-change-dot")).toBeNull();
  });

  it("opens once on the first visit, persists closing and closes with Escape", () => {
    localStorage.removeItem(DIGEST_EXPANDED_KEY);
    controller.digest = SAMPLE;
    const first = render(
      <AntdApp>
        <AssistantDigestCard />
      </AntdApp>,
    );
    const trigger = screen.getByRole("button", {
      name: new RegExp(t("assistantBreadth.digest.title")),
    });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem(DIGEST_EXPANDED_KEY)).toBe("false");
    first.unmount();
    render(
      <AntdApp>
        <AssistantDigestCard />
      </AntdApp>,
    );
    const reopened = screen.getByRole("button", {
      name: new RegExp(t("assistantBreadth.digest.title")),
    });
    expect(reopened).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(reopened);
    expect(reopened).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(reopened);
    expect(reopened).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the popover open while regenerating and does not reopen for new changes", () => {
    controller.digest = SAMPLE;
    const rendered = renderCard();
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("assistantBreadth.digest.refresh")) }),
    );
    expect(
      screen.getByRole("button", { name: new RegExp(t("assistantBreadth.digest.title")) }),
    ).toHaveAttribute("aria-expanded", "true");
    // 摘要按钮的无障碍名＝标题 + 计数（axe 要求名字包含可见文字），所以按前缀匹配。
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("assistantBreadth.digest.title")) }),
    );
    controller.digest = { ...SAMPLE, changes: { count: 8, jd_changed: 8, stale: 0 } };
    rendered.rerender(
      <AntdApp>
        <AssistantDigestCard />
      </AntdApp>,
    );
    expect(
      screen.getByRole("button", { name: new RegExp(t("assistantBreadth.digest.title")) }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});
