// SPDX-License-Identifier: Apache-2.0
/**
 * F07：网申登录态按站点逐项展示/检测。
 *
 * 钉住四条会给用户造成误导的行为：
 * 1. 打开抽屉只读缓存，**不发任何检测**（浏览器类检测会弹窗）；
 * 2. 有站点时父行只汇总，不再有「检测 / 重新登录」两颗按钮（一个笼统的"正常"没有意义）；
 * 3. 站点行点「检测」只带 host，不带 URL（服务端清单之外的一律拒绝）；
 * 4. 「全部检测」按 投递浏览器 → 各站点串行；
 * 5. 超过上限时提示还有几个站点没列出来。
 *
 * 面板只有两个来源：第三行「门户 Cookie」已随「申请状态回读」整条移除（T2），
 * 后端不会再下发它，mock 里也就不该再造一条——否则"串行顺序"这条用例验的是一个
 * 生产上不存在的来源。
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
  listWebformSites: vi.fn(),
  checkWebformSite: vi.fn(),
  reloginWebformSite: vi.fn(),
  getAccountNote: vi.fn(),
  saveAccountNote: vi.fn(),
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
    account: "",
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
      host: "www.zhipin.com",
      account: "",
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
      // 汇总行没有"自己的"账号：备注按站点各自带着（与后端口径一致）。
      host: "",
      account: "",
      sites,
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

/** antd 会给"恰好两个汉字"的按钮自动插空格（检测 → 检 测、保存 → 保 存），按可访问名取要容忍这一层。 */
const CHECK_NAME = /^检\s*测$/;
const SAVE_NAME = /^保\s*存$/;

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
    expect(screen.getByText(t("applyUi.loginStatus.siteTruncated", { count: 2 }))).toBeTruthy();
  });

  it("没有探测地址时检测/重登置灰，并按来源给提示（F12）", async () => {
    renderDrawer();

    // i18n-ok: 断言后端下发的 source_label
    await screen.findByText("网申浏览器");
    expect(screen.getByText(t("applyUi.loginStatus.noProbe.webform"))).toBeTruthy();
    // 「门户 Cookie」那一行随「申请状态回读」整条移除（T2）：面板现在只有投递与网申两行。
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

  it("「全部检测」串行跑：投递浏览器 → 各站点", async () => {
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
    // 有站点时网申父行只汇总、不单独探测（F07），所以它不出现在执行顺序里。
    expect(order).toEqual([
      "source:apply_browser",
      "site:moka.example.com",
      "site:beisen.example.com",
    ]);
    expect(apiMocks.checkLoginStatus).toHaveBeenCalledTimes(1);
  });
});

describe("原条目 7 A1：「无法判断」必须可解释", () => {
  it("行内显示具体原因，面板固定位置给「为什么 + 怎么做」与换机提示", async () => {
    const rows = baseRows([]);
    // detail 用 ASCII：这条验的是"后端下发的 detail 原样显示"，与那句话用什么语言写无关；
    // 中文断言会让 `cjkRatchet` 的 tests 口径多计一行（该守卫只降不升）。
    const REASON = "no account marker found on the page";
    apiMocks.listLoginStatuses.mockResolvedValue([
      {
        ...rows[0],
        status: "unknown" as const,
        detail: REASON,
      },
      rows[1],
    ]);

    renderDrawer();

    // 后端下发的 detail 原样显示（前端不再自造原因）。
    await waitFor(() => expect(screen.getAllByText(new RegExp(REASON)).length).toBeGreaterThan(0));
    // `unknown` 的两行各给一条说明（apply_browser 与无站点的网申父行），所以用 AllBy。
    expect(screen.getAllByText(t("applyUi.loginStatus.unknownHint")).length).toBeGreaterThan(0);
    // 换机提示是固定文案：与检测结果无关，必须一直在。
    expect(screen.getByText(t("applyUi.loginStatus.localOnlyHint"))).toBeTruthy();
  });
});

describe("原条目 8 A1：账号备注", () => {
  it("站点行显示「未填写」，编辑后调 saveAccountNote 并就地显示新值", async () => {
    const sites = [site("moka.example.com", "ok")];
    apiMocks.listLoginStatuses.mockResolvedValue(baseRows(sites));
    apiMocks.listWebformSites.mockResolvedValue(payload(sites));
    // 备注值用 ASCII：这条验的是"保存后就地显示服务端返回的值"，与语言无关；
    // 中文值会让 `cjkRatchet` 的 tests 口径多计一行（该守卫只降不升）。
    const NOTE = "zhangsan@example.com (personal)";
    // 备注与「账号备注」标签拼在同一节点里：断言用子串正则，不用整串相等。
    const NOTE_MATCH = /zhangsan@example\.com/;
    apiMocks.saveAccountNote.mockResolvedValue({
      host: "moka.example.com",
      note: NOTE,
    });

    renderDrawer();
    await screen.findByText("moka.example.com");
    const row = document.querySelector(".login-status-site") as HTMLElement;

    // 空备注不能留一个空洞：占位文案要明确说「未填写」。
    expect(
      within(row).getByText(new RegExp(t("applyUi.loginStatus.accountLabel.empty"))),
    ).toBeTruthy();

    fireEvent.click(
      within(row).getByRole("button", { name: t("applyUi.loginStatus.accountLabel.edit") }),
    );
    fireEvent.change(
      within(row).getByRole("textbox", { name: t("applyUi.loginStatus.accountLabel") }),
      { target: { value: NOTE } },
    );
    fireEvent.click(within(row).getByRole("button", { name: SAVE_NAME }));

    await waitFor(() =>
      expect(apiMocks.saveAccountNote).toHaveBeenCalledWith("moka.example.com", NOTE),
    );
    // 就地刷新（不重取整份清单）：显示的是服务端落库后的值。
    await waitFor(() =>
      expect(
        within(document.querySelector(".login-status-site") as HTMLElement).getByText(NOTE_MATCH),
      ).toBeTruthy(),
    );
    expect(apiMocks.listLoginStatuses).toHaveBeenCalledTimes(1);
  });

  it("投递浏览器行已知 host 时用同一条备注", async () => {
    const rows = baseRows([]);
    apiMocks.listLoginStatuses.mockResolvedValue([
      { ...rows[0], account: "boss-account" },
      rows[1],
    ]);

    renderDrawer();

    await waitFor(() => expect(screen.getAllByText(/boss-account/).length).toBeGreaterThan(0));
  });

  it("清空备注后回到「未填写」", async () => {
    const sites = [{ ...site("moka.example.com", "ok"), account: "old-note" }];
    apiMocks.listLoginStatuses.mockResolvedValue(baseRows(sites));
    apiMocks.listWebformSites.mockResolvedValue(payload(sites));
    apiMocks.saveAccountNote.mockResolvedValue({ host: "moka.example.com", note: "" });

    renderDrawer();
    await screen.findByText("moka.example.com");
    const row = document.querySelector(".login-status-site") as HTMLElement;

    fireEvent.click(
      within(row).getByRole("button", { name: t("applyUi.loginStatus.accountLabel.edit") }),
    );
    fireEvent.change(
      within(row).getByRole("textbox", { name: t("applyUi.loginStatus.accountLabel") }),
      { target: { value: "" } },
    );
    fireEvent.click(within(row).getByRole("button", { name: SAVE_NAME }));

    await waitFor(() =>
      expect(apiMocks.saveAccountNote).toHaveBeenCalledWith("moka.example.com", ""),
    );
    await waitFor(() =>
      expect(
        within(document.querySelector(".login-status-site") as HTMLElement).getByText(
          new RegExp(t("applyUi.loginStatus.accountLabel.empty")),
        ),
      ).toBeTruthy(),
    );
  });
});
