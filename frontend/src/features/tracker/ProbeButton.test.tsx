// SPDX-License-Identifier: Apache-2.0
/**
 * 申请状态回读的入口（R-15 C）。
 *
 * 钉的是三条**用户能感觉到的**行为：
 * 1. 没配 Cookie 时不偷偷抓一轮就说"没变化"，而是先问；
 * 2. 读到变化才刷新列表（否则每点一次都白闪一遍）；
 * 3. 开「每日自动」必须先有 Cookie，否则开关看起来打开了却永远不生效。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProbeButton from "./ProbeButton";
import {
  getProbeSettings,
  probeDaily,
  probePage,
  probeTracks,
  saveProbeSettings,
  type TrackProbeResult,
  type TrackProbeSettings,
} from "../../api/tracker";
import { t } from "../../i18n";
import type { Track } from "../../types";

// 断言用的是**回读结果里的值**（fixture 数据），不是界面文案；提到常量里，
// 既避免在 ByText 参数里写中文，也保证 fixture 与断言不会各改一半。
const SCREENING_LABEL = "筛选中";
const SCREENING_NOTE = "命中「under review」";

vi.mock("../../api/tracker", () => ({
  getProbeSettings: vi.fn(),
  probeTracks: vi.fn(),
  probePage: vi.fn(),
  probeDaily: vi.fn(),
  saveProbeSettings: vi.fn(),
}));

const SETTINGS_OFF: TrackProbeSettings = {
  enabled: false,
  has_cookie: false,
  last_run: "",
  due: false,
  interval_hours: 20,
  page_url: "",
};

const SETTINGS_READY: TrackProbeSettings = { ...SETTINGS_OFF, has_cookie: true };

function _track(id: number): Track {
  return {
    id,
    company: "示例科技",
    title: "后端开发实习生",
    status: "applied",
    stage_note: "",
    applied_at: "2026-09-18",
    status_date: "",
    next_action: "",
    next_action_date: "",
    note: "",
    evidence: "",
    source: "manual",
    created_at: "2026-09-18T00:00:00",
    updated_at: "2026-09-18T00:00:00",
    job_id: null,
    resume_id: null,
    resume_title: "",
    channel: "unknown",
  };
}

function _result(overrides: Partial<TrackProbeResult> = {}): TrackProbeResult {
  return {
    items: [],
    changed: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    ran: true,
    due: false,
    ...overrides,
  };
}

function renderButton(onRefreshed = vi.fn(), tracks = [_track(1), _track(2)]) {
  render(
    <AntdApp>
      <ProbeButton tracks={tracks} onRefreshed={onRefreshed} />
    </AntdApp>,
  );
  return { onRefreshed };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("申请状态回读入口", () => {
  it("没有 Cookie 时先问一句，选「先用公开页」才真的去抓", async () => {
    vi.mocked(getProbeSettings).mockResolvedValue(SETTINGS_OFF);
    vi.mocked(probeTracks).mockResolvedValue(_result({ unchanged: 2 }));
    renderButton();

    await waitFor(() => expect(getProbeSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("trackProbe.action")) }));

    // 弹层出现，且此时一条请求都还没发。
    // antd 的 Modal 会为无障碍再渲染一份标题文本，`findByText` 会撞到两个。
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(probeTracks).not.toHaveBeenCalled();

    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: t("trackProbe.cookieSkip"),
      }),
    );
    await waitFor(() => expect(probeTracks).toHaveBeenCalledWith([1, 2], 8));
  });

  it("读到变化才刷新列表，并把前后状态摆出来", async () => {
    vi.mocked(getProbeSettings).mockResolvedValue(SETTINGS_READY);
    vi.mocked(probeTracks).mockResolvedValue(
      _result({
        changed: 1,
        items: [
          {
            track_id: 1,
            company: "示例科技",
            title: "后端开发实习生",
            url: "https://boards.greenhouse.io/acme/jobs/1",
            platform: "greenhouse",
            outcome: "changed",
            before: "applied",
            before_label: "已投递",
            after: "screening",
            after_label: SCREENING_LABEL,
            note: SCREENING_NOTE,
          },
        ],
      }),
    );
    const { onRefreshed } = renderButton();

    await waitFor(() => expect(getProbeSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("trackProbe.action")) }));

    await waitFor(() => expect(onRefreshed).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(SCREENING_LABEL)).toBeTruthy();
    expect(screen.getByText(SCREENING_NOTE)).toBeTruthy();
  });

  it("开「每日自动」前必须有 Cookie：保存后自动把开关打开", async () => {
    vi.mocked(getProbeSettings).mockResolvedValue(SETTINGS_OFF);
    vi.mocked(saveProbeSettings)
      .mockResolvedValueOnce({ ...SETTINGS_READY, enabled: false })
      .mockResolvedValueOnce({ ...SETTINGS_READY, enabled: true });
    renderButton();

    await waitFor(() => expect(getProbeSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("switch", { name: t("trackProbe.auto") }));
    // antd 的 Modal 会为无障碍再渲染一份标题文本，`findByText` 会撞到两个。
    expect(await screen.findByRole("dialog")).toBeTruthy();

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(t("trackProbe.cookieTitle")), {
      target: { value: "session=abc" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("trackProbe.cookieSave") }));

    await waitFor(() => expect(saveProbeSettings).toHaveBeenCalledTimes(2));
    expect(saveProbeSettings).toHaveBeenNthCalledWith(1, { cookie: "session=abc" });
    expect(saveProbeSettings).toHaveBeenNthCalledWith(2, { enabled: true });
  });

  it("配了投递记录页时先读那一页，没覆盖到的再逐条读岗位页", async () => {
    vi.mocked(getProbeSettings).mockResolvedValue({
      ...SETTINGS_READY,
      page_url: "https://acme.jobs.feishu.cn/apps",
    });
    vi.mocked(probePage).mockResolvedValue(
      _result({
        changed: 1,
        items: [
          {
            track_id: 1,
            company: "示例科技",
            title: "后端开发实习生",
            url: "https://acme.jobs.feishu.cn/apps",
            platform: "feishu",
            outcome: "changed",
            before: "applied",
            before_label: "已投递",
            after: "interview",
            after_label: "面试",
            note: "命中「面试中」",
          },
        ],
      }),
    );
    vi.mocked(probeTracks).mockResolvedValue(_result({ unchanged: 1 }));
    renderButton();

    await waitFor(() => expect(getProbeSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("trackProbe.action")) }));

    // 一次请求覆盖整页，只把页面上没找到的那条（id=2）留给逐条模式。
    await waitFor(() =>
      expect(probePage).toHaveBeenCalledWith("https://acme.jobs.feishu.cn/apps", [1, 2]),
    );
    await waitFor(() => expect(probeTracks).toHaveBeenCalledWith([2], 8));
  });

  it("没有进行中的记录时给一句话，不发起网络请求", async () => {
    vi.mocked(getProbeSettings).mockResolvedValue(SETTINGS_READY);
    renderButton(vi.fn(), [{ ..._track(9), status: "rejected" }]);

    await waitFor(() => expect(getProbeSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("trackProbe.action")) }));
    await waitFor(() => expect(probeTracks).not.toHaveBeenCalled());
  });

  it("到期的每日自动会在打开页面时跑一次，且只跑一次", async () => {
    vi.mocked(getProbeSettings).mockResolvedValue({ ...SETTINGS_READY, enabled: true, due: true });
    vi.mocked(probeDaily).mockResolvedValue(_result({ unchanged: 2 }));
    const { onRefreshed } = renderButton();

    await waitFor(() => expect(probeDaily).toHaveBeenCalledTimes(1));
    // 没有变化就不刷新列表、也不弹抽屉。
    expect(onRefreshed).not.toHaveBeenCalled();
    expect(screen.queryByText(t("trackProbe.resultTitle"))).toBeNull();
  });
});
