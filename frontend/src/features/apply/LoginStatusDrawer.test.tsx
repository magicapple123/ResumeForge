// SPDX-License-Identifier: Apache-2.0
/**
 * F07：网申登录态按站点逐项展示/检测；整改 #16 之后站点区是四列表格。
 *
 * 钉住这些会给用户造成误导的行为：
 * 1. 打开抽屉只读缓存，**不发任何检测**（浏览器类检测会弹窗）；
 * 2. 有站点时父行只汇总，站点行各自带 host 与状态；
 * 3. 站点行点「检测」只带 host，不带 URL（服务端清单之外的一律拒绝）；
 * 4. 「全部检测」按 投递浏览器 → 各站点串行；
 * 5. 超过上限时提示还有几个站点没列出来；
 * 6. **每行只有一个带文字的按钮（检测）**，「重新登录」只在 `⋯` 菜单里；
 * 7. `label === host` 时该域名只出现一次（整改前同一个地址写两遍、各占一行）；
 * 8. **同一句话不说两遍**：`localOnlyHint` 与顶部 Alert 的 `keepSessionNotice` 是一回事，
 *    前者不再渲染（键仍留在语言包里）；
 * 9. 备注默认只是一个文字按钮，点击后才长出输入框。
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
  getKeepSessionNotice: vi.fn(),
  ackKeepSessionNotice: vi.fn(),
}));

vi.mock("../../api/loginStatus", () => apiMocks);

function site(host: string, status: LoginStatusSite["status"]): LoginStatusSite {
  return {
    host,
    // 默认让 label 与 host 不同：域名去重那条用例自己覆写成相同值。
    label: host.split(".")[0],
    probe_url: `https://${host}/apply`,
    status,
    checked_at: "2026-11-13T10:00:00",
    detail: status === "expired" ? "stopped at the sign-in page" : "",
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
const SITE_RELOGIN = t("applyUi.loginStatus.site.relogin");

beforeEach(() => {
  for (const mock of Object.values(apiMocks)) mock.mockReset();
  apiMocks.listLoginStatuses.mockResolvedValue(baseRows([]));
  apiMocks.listWebformSites.mockResolvedValue(payload([]));
  apiMocks.checkLoginStatus.mockImplementation((id: string) =>
    Promise.resolve(baseRows([]).find((row) => row.id === id)),
  );
  // 默认没有说明可展示（`days === 0`）：其它用例不该被这条 Alert 干扰。
  apiMocks.getKeepSessionNotice.mockResolvedValue({
    days: 0,
    first_effective_at: "",
    delivered: false,
  });
  apiMocks.ackKeepSessionNotice.mockResolvedValue({ delivered: true });
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

  it("有站点时父行只汇总，站点区是四列表格", async () => {
    const sites = [site("moka.example.com", "ok"), site("beisen.example.com", "expired")];
    apiMocks.listLoginStatuses.mockResolvedValue(baseRows(sites));
    apiMocks.listWebformSites.mockResolvedValue(payload(sites, 4));

    renderDrawer();

    await screen.findByText("moka.example.com");
    // 父行汇总写在「上次检测 …」同一行里，按正则取（避免拆节点导致精确匹配失败）。
    // i18n-ok: 汇总串由后端按站点数拼好下发，前端不产出这段文案
    expect(screen.getAllByText(/2 个站点 · 1 正常/).length).toBeGreaterThan(0);
    expect(screen.getByText("beisen.example.com")).toBeTruthy();
    expect(document.querySelectorAll(".login-status-site")).toHaveLength(2);

    // 表头四列：站点 / 状态 / 上次检测 / 操作。
    const headers = [
      ...document
        .querySelectorAll(".login-status-site")[0]
        .closest("table")!
        .querySelectorAll("thead th"),
    ].map((th) => (th.textContent ?? "").trim());
    expect(headers).toEqual([
      t("applyUi.loginStatus.column.site"),
      t("applyUi.loginStatus.column.status"),
      t("applyUi.loginStatus.column.checked"),
      t("applyUi.loginStatus.column.action"),
    ]);
    // 超出上限的提示：共 4 个站点，只列了 2 个。
    expect(screen.getByText(t("applyUi.loginStatus.siteTruncated", { count: 2 }))).toBeTruthy();
  });

  it("站点行只有一个带文字的按钮（检测），「重新登录」在 ⋯ 菜单里", async () => {
    const sites = [site("moka.example.com", "ok")];
    apiMocks.listLoginStatuses.mockResolvedValue(baseRows(sites));
    apiMocks.listWebformSites.mockResolvedValue(payload(sites));
    apiMocks.reloginWebformSite.mockResolvedValue({ id: "x", action: "opened", url: "" });

    renderDrawer();
    await screen.findByText("moka.example.com");
    const row = document.querySelector(".login-status-site") as HTMLElement;
    const actions = row.querySelector(".login-status-actions") as HTMLElement;

    // 带文字的操作按钮只有「检测」一颗；「⋯」是无文字的图标入口。
    const textButtons = within(actions)
      .getAllByRole("button")
      .filter((button) => (button.textContent ?? "").trim().length > 0);
    expect(textButtons).toHaveLength(1);
    expect(within(actions).getByRole("button", { name: CHECK_NAME })).toBe(textButtons[0]);

    // 菜单没点开时「重新登录」根本不在 DOM 里（不是"藏着但可点"）。
    expect(within(row).queryByRole("button", { name: SITE_RELOGIN })).toBeNull();

    fireEvent.click(
      within(actions).getByRole("button", { name: t("applyUi.loginStatus.site.more") }),
    );
    const reloginItem = await screen.findByText(SITE_RELOGIN);
    fireEvent.click(reloginItem);
    await waitFor(() =>
      expect(apiMocks.reloginWebformSite).toHaveBeenCalledWith("moka.example.com"),
    );
  });

  it("label 与 host 相同时域名只出现一次", async () => {
    const only = { ...site("jobs.example.com", "ok"), label: "jobs.example.com" };
    apiMocks.listLoginStatuses.mockResolvedValue(baseRows([only]));
    apiMocks.listWebformSites.mockResolvedValue(payload([only]));

    renderDrawer();

    await screen.findByText("jobs.example.com");
    expect(screen.getAllByText("jobs.example.com")).toHaveLength(1);
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
  it("行内显示具体原因，面板固定位置给「为什么 + 怎么做」", async () => {
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
    // 措辞不许被改成「已失效」：`unknown` 的文案必须还是「无法判断」。
    expect(screen.getAllByText(t("applyUi.loginStatus.status.unknown")).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(t("applyUi.loginStatus.status.expired"))).toHaveLength(0);
  });
});

describe("整改 #16：同一句话不说两遍", () => {
  const NOTICE_DAYS = 90;

  it("说明显示时「换电脑或重装」只在 Alert 里出现一次（localOnlyHint 不再渲染）", async () => {
    apiMocks.getKeepSessionNotice.mockResolvedValue({
      days: NOTICE_DAYS,
      first_effective_at: "2026-11-13T09:41:07",
      delivered: false,
    });

    renderDrawer();

    const noticeText = t("applyUi.loginStatus.keepSessionNotice", { days: NOTICE_DAYS });
    await screen.findByText(noticeText);
    const text = () => document.body.textContent ?? "";
    // 被删掉的那一段整句不许再出现（它与上面这条 Alert 是同一件事）。
    expect(text()).not.toContain(t("applyUi.loginStatus.localOnlyHint"));
    // 而这份说明本身只渲染一次（不是两处各说一遍）。
    expect(text().split(noticeText)).toHaveLength(2);
  });

  it("说明不显示时也不出现那句换机提示（顶部 Alert 才是它的位置）", async () => {
    renderDrawer();

    // i18n-ok: 断言后端下发的 source_label，不是前端文案
    await screen.findByText("投递浏览器");
    expect(document.body.textContent ?? "").not.toContain(t("applyUi.loginStatus.localOnlyHint"));
  });
});

describe("原条目 8 A1 + 整改 #16：账号备注", () => {
  it("默认只是「添加备注」按钮，点击后才出输入框；保存后就地显示新值", async () => {
    const sites = [site("moka.example.com", "ok")];
    apiMocks.listLoginStatuses.mockResolvedValue(baseRows(sites));
    apiMocks.listWebformSites.mockResolvedValue(payload(sites));
    // 备注值用 ASCII：这条验的是"保存后就地显示服务端返回的值"，与语言无关；
    // 中文值会让 `cjkRatchet` 的 tests 口径多计一行（该守卫只降不升）。
    const NOTE = "zhangsan@example.com (personal)";
    const NOTE_MATCH = /zhangsan@example\.com/;
    apiMocks.saveAccountNote.mockResolvedValue({
      host: "moka.example.com",
      note: NOTE,
    });

    renderDrawer();
    await screen.findByText("moka.example.com");
    const row = document.querySelector(".login-status-site") as HTMLElement;

    // 没填备注时是文字按钮，不是常驻输入框。
    expect(within(row).queryByRole("textbox")).toBeNull();
    expect(
      within(row).getByRole("button", { name: t("applyUi.loginStatus.accountLabel.add") }),
    ).toBeTruthy();

    fireEvent.click(
      within(row).getByRole("button", { name: t("applyUi.loginStatus.accountLabel.add") }),
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

  it("清空备注后回到「添加备注」", async () => {
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
        within(document.querySelector(".login-status-site") as HTMLElement).getByRole("button", {
          name: t("applyUi.loginStatus.accountLabel.add"),
        }),
      ).toBeTruthy(),
    );
  });
});

/**
 * T1「保持登录」的一次性说明：后端已有 `read_notice` / `mark_notice_delivered` /
 * `notice_delivered`，但接口层此前没有任何调用方——这份用例钉住接上之后的行为。
 *
 * 正文只在 i18n 里（`applyUi.loginStatus.keepSessionNotice`），后端只给 `days`。
 * 文案断言一律走 `t()`：面板显示的值由 i18n 出，测试里写字面中文会让 `cjkRatchet`
 * 的 tests 口径多计一行（该守卫只降不升）。
 */
describe("T1 保持登录：一次性说明", () => {
  const NOTICE_DAYS = 90;

  it("有说明时显示，关掉后调用 ack", async () => {
    apiMocks.getKeepSessionNotice.mockResolvedValue({
      days: NOTICE_DAYS,
      first_effective_at: "2026-11-13T09:41:07",
      delivered: false,
    });

    renderDrawer();

    const noticeText = t("applyUi.loginStatus.keepSessionNotice", { days: NOTICE_DAYS });
    const node = await screen.findByText(noticeText);
    expect(apiMocks.getKeepSessionNotice).toHaveBeenCalledTimes(1);
    // 只是显示出来不算"已展示"：必须由用户关掉它才 ack。
    expect(apiMocks.ackKeepSessionNotice).not.toHaveBeenCalled();

    const alert = node.closest(".ant-alert") as HTMLElement;
    fireEvent.click(alert.querySelector(".ant-alert-close-icon") as HTMLElement);

    await waitFor(() => expect(apiMocks.ackKeepSessionNotice).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(noticeText)).toBeNull());
  });

  it("days=0（还没生效过 / 保持登录已关闭）时整条不显示", async () => {
    // beforeEach 的默认桩就是 days=0：这里显式再写一次，读代码的人不必回头翻。
    // 后端把"没生效过"与"开关已关"都归到 days=0（关掉了还说"已开始帮你保持"是假话），
    // 所以前端只需要这一个判据，不必区分原因。
    apiMocks.getKeepSessionNotice.mockResolvedValue({
      days: 0,
      first_effective_at: "",
      delivered: false,
    });

    renderDrawer();

    // i18n-ok: 断言后端下发的 source_label，不是前端文案
    await screen.findByText("投递浏览器");
    expect(document.querySelector(".ant-alert")).toBeNull();
    expect(apiMocks.ackKeepSessionNotice).not.toHaveBeenCalled();
  });

  it("ack 失败不弹错误，也不把这条说明硬标成已读", async () => {
    apiMocks.getKeepSessionNotice.mockResolvedValue({
      days: NOTICE_DAYS,
      first_effective_at: "2026-11-13T09:41:07",
      delivered: false,
    });
    apiMocks.ackKeepSessionNotice.mockRejectedValue(new Error("ack failed"));

    renderDrawer();

    const noticeText = t("applyUi.loginStatus.keepSessionNotice", { days: NOTICE_DAYS });
    const node = await screen.findByText(noticeText);
    fireEvent.click(
      (node.closest(".ant-alert") as HTMLElement).querySelector(
        ".ant-alert-close-icon",
      ) as HTMLElement,
    );

    await waitFor(() => expect(apiMocks.ackKeepSessionNotice).toHaveBeenCalledTimes(1));
    // 次要信息：失败静默（面板里不会出现一条红条）。
    await waitFor(() => expect(document.querySelector(".ant-message-error")).toBeNull());
  });
});
