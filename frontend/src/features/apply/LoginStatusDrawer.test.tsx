// SPDX-License-Identifier: Apache-2.0
/**
 * F07：网申登录态按站点逐项展示/检测。
 *
 * 钉住四条会给用户造成误导的行为：
 * 1. 打开抽屉只读缓存，**不发任何检测**（浏览器类检测会弹窗）；
 * 2. 有站点时父行只汇总，不再有「检测 / 重新登录」两颗按钮（一个笼统的"正常"没有意义）；
 * 3. 站点行点「检测」只带 host，不带 URL（服务端清单之外的一律拒绝）；
 * 4. 「全部检测」按 投递浏览器 → 各站点 → 门户 Cookie 串行；
 * 5. 超过上限时提示还有几个站点没列出来。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { LoginStatusRow, LoginStatusSite, WebFormSiteList } from "../../api/loginStatus";
import LoginStatusDrawer from "./LoginStatusDrawer";

const apiMocks = vi.hoisted(() => ({
  listLoginStatuses: vi.fn(),
  checkLoginStatus: vi.fn(),
  relogin: vi.fn(),
  saveTrackCookie: vi.fn(),
  listWebformSites: vi.fn(),
  checkWebformSite: vi.fn(),
  reloginWebformSite: vi.fn(),
}));

vi.mock("../../api/loginStatus", () => apiMocks);

function site(host: string, status: LoginStatusSite["status"]): LoginStatusSite {
  return {
    host,
    label: host.split(".")[0],
    probe_url: `https://${host}/apply`,
    status,
    checked_at: "2026-11-13T10:00:00",
    detail: status === "expired" ? "停在登录页" : "",
  };
}

function baseRows(sites: LoginStatusSite[]): LoginStatusRow[] {
  const ok = sites.filter((item) => item.status === "ok").length;
  const aggregate = sites.some((item) => item.status === "expired")
    ? "expired"
    : sites.length > 0 && ok === sites.length
      ? "ok"
      : "unknown";
  return [
    {
      id: "apply_browser",
      label: "投递浏览器",
      browser: true,
      probe_url: "https://www.zhipin.com",
      status: "ok",
      checked_at: "2026-11-13T09:00:00",
      detail: "",
      sites: [],
    },
    {
      id: "webform_browser",
      label: "网申浏览器",
      browser: true,
      probe_url: sites[0]?.probe_url ?? "",
      status: aggregate,
      checked_at: "2026-11-13T10:00:00",
      detail: sites.length ? `${sites.length} 个站点 · ${ok} 正常` : "",
      sites,
    },
    {
      id: "track_cookie",
      label: "门户 Cookie",
      browser: false,
      probe_url: "",
      status: "unchecked",
      checked_at: "",
      detail: "未配置 Cookie",
      sites: [],
    },
  ];
}

function payload(items: LoginStatusSite[], total = items.length): WebFormSiteList {
  return { items, total, truncated: Math.max(0, total - items.length) };
}

function renderDrawer() {
  return render(
    <AntdApp>
      <LoginStatusDrawer open onClose={vi.fn()} />
    </AntdApp>,
  );
}

/** antd 会给"恰好两个汉字"的按钮自动插空格（检测 → 检 测），按可访问名取要容忍这一层。 */
const CHECK_NAME = /^检\s*测$/;

beforeEach(() => {
  for (const mock of Object.values(apiMocks)) mock.mockReset();
  apiMocks.listLoginStatuses.mockResolvedValue(baseRows([]));
  apiMocks.listWebformSites.mockResolvedValue(payload([]));
  apiMocks.checkLoginStatus.mockImplementation((id: string) =>
    Promise.resolve(baseRows([]).find((row) => row.id === id)),
  );
});

afterEach(cleanup);

describe("F07 登录状态：网申逐站点", () => {
  it("打开抽屉只读缓存，不发检测请求", async () => {
    renderDrawer();

    // i18n-ok: 断言后端下发的 source_label，不是前端文案
    await screen.findByText("投递浏览器");
    expect(apiMocks.listLoginStatuses).toHaveBeenCalledTimes(1);
    expect(apiMocks.listWebformSites).toHaveBeenCalledTimes(1);
    expect(apiMocks.checkLoginStatus).not.toHaveBeenCalled();
    expect(apiMocks.checkWebformSite).not.toHaveBeenCalled();
  });

  it("有站点时父行只汇总，站点行各自带 host 与状态", async () => {
    const sites = [site("moka.example.com", "ok"), site("beisen.example.com", "expired")];
    apiMocks.listLoginStatuses.mockResolvedValue(baseRows(sites));
    apiMocks.listWebformSites.mockResolvedValue(payload(sites, 4));

    renderDrawer();

    await screen.findByText("moka.example.com");
    // 父行汇总写在「上次检测 …」同一行里，按正则取（避免拆节点导致精确匹配失败）。
    // i18n-ok: 汇总串由后端按站点数拼好下发，前端不产出这段文案
    expect(screen.getAllByText(/2 个站点 · 1 正常/).length).toBeGreaterThan(0);
    expect(screen.getByText("beisen.example.com")).toBeTruthy();
    // 站点行各自有一对「检测 / 重新登录」，父行不再提供这两颗（父行只汇总）。
    const siteRows = document.querySelectorAll(".login-status-site");
    expect(siteRows).toHaveLength(2);
    for (const row of siteRows) {
      expect(within(row as HTMLElement).getByRole("button", { name: CHECK_NAME })).toBeTruthy();
      expect(
        within(row as HTMLElement).getByRole("button", {
          name: t("applyUi.loginStatus.site.relogin"),
        }),
      ).toBeTruthy();
    }
    // 超出上限的提示：共 4 个站点，只列了 2 个。
    expect(
      screen.getByText(t("applyUi.loginStatus.siteTruncated", { count: 2 })),
    ).toBeTruthy();
  });

  it("没有探测地址时检测/重登置灰，并按来源给提示（F12）", async () => {
    renderDrawer();

    // i18n-ok: 断言后端下发的 source_label
    await screen.findByText("网申浏览器");
    expect(screen.getByText(t("applyUi.loginStatus.noProbe.webform"))).toBeTruthy();
    expect(screen.getByText(t("applyUi.loginStatus.noProbe.track"))).toBeTruthy();
    // i18n-ok: 断言后端下发的 source_label
    const card = screen.getByText("网申浏览器").closest("div")?.parentElement as HTMLElement;
    for (const button of within(card).getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });

  it("站点行点「检测」只带 host，不带 URL", async () => {
    const sites = [site("moka.example.com", "ok")];
    apiMocks.listLoginStatuses.mockResolvedValue(baseRows(sites));
    apiMocks.listWebformSites.mockResolvedValue(payload(sites));
    apiMocks.checkWebformSite.mockResolvedValue(site("moka.example.com", "expired"));

    renderDrawer();
    await screen.findByText("moka.example.com");
    const siteRow = document.querySelector(".login-status-site") as HTMLElement;
    fireEvent.click(within(siteRow).getByRole("button", { name: CHECK_NAME }));

    await waitFor(() => expect(apiMocks.checkWebformSite).toHaveBeenCalledWith("moka.example.com"));
  });

  it("「全部检测」串行跑：投递浏览器 → 站点 → 门户 Cookie", async () => {
    const sites = [site("moka.example.com", "ok"), site("beisen.example.com", "ok")];
    apiMocks.listLoginStatuses.mockResolvedValue(baseRows(sites));
    apiMocks.listWebformSites.mockResolvedValue(payload(sites));
    const order: string[] = [];
    apiMocks.checkLoginStatus.mockImplementation((id: string) => {
      order.push(`source:${id}`);
      return Promise.resolve(baseRows(sites).find((row) => row.id === id));
    });
    apiMocks.checkWebformSite.mockImplementation((host: string) => {
      order.push(`site:${host}`);
      return Promise.resolve(site(host, "ok"));
    });

    renderDrawer();
    await screen.findByText("moka.example.com");
    fireEvent.click(screen.getByRole("button", { name: t("applyUi.loginStatus.action.checkAll") }));

    await waitFor(() => expect(apiMocks.checkWebformSite).toHaveBeenCalledTimes(2));
    expect(order).toEqual([
      "source:apply_browser",
      "site:moka.example.com",
      "site:beisen.example.com",
      "source:track_cookie",
    ]);
  });
});
