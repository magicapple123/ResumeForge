// SPDX-License-Identifier: Apache-2.0
/**
 * 桌面形态的「软件更新」卡片：只认壳层的结论，绝不替它宣布「未提供」。
 *
 * 为什么值得单独一组用例（B1）：桌面壳有自己的出网链路（Chromium 栈、走系统代理），
 * 与后端的 httpx 是两条路。后端被 GitHub 403 限流时它会降级成"没有版本号"，而壳层
 * 同一时刻可能已经查到 2.3.0 并弹窗——设置页如果在这种时刻写「未提供」，同一件事就
 * 有了两个相反的结论。这里钉住三档措辞：壳层有结论 → 照抄；壳层查失败 → 「本次未能
 * 确认」；还没查 → 请用户去查。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import I18nProvider from "../../i18n/I18nProvider";
import { selectLocale } from "../../i18n/localeStore";
import DesktopUpdateCard from "./DesktopUpdateCard";
import type { DesktopUpdateState, InAppUpdateBridge } from "./desktopUpdateBridge";

/** 壳层快照的默认值（字段与 `desktop/lib/desktop-update-session.js` 的初值一致）。 */
function snapshot(overrides: Partial<DesktopUpdateState> = {}): DesktopUpdateState {
  return {
    phase: "idle",
    manual: false,
    current: "2.2.2",
    latest: "",
    published: "",
    notes: "",
    size: null,
    received: 0,
    total: null,
    request: 0,
    sequence: 1,
    error: "",
    ...overrides,
  };
}

function makeBridge(initial: DesktopUpdateState): InAppUpdateBridge {
  return {
    getUpdateState: async () => initial,
    onUpdateState: () => () => undefined,
    checkUpdate: vi.fn(async () => ({ ok: true })),
    startUpdate: vi.fn(async () => true),
  };
}

function mount(state: DesktopUpdateState) {
  render(
    <I18nProvider>
      <DesktopUpdateCard bridge={makeBridge(state)} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  selectLocale("zh-CN");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  selectLocale("zh-CN");
});

describe("DesktopUpdateCard", () => {
  it("壳层已经查到 2.3.0 时照抄它的结论，不出现「未提供」", async () => {
    mount(
      snapshot({
        phase: "available",
        latest: "2.3.0",
        published: "2026-11-21T10:00:00Z",
      }),
    );

    // 当前版本（2.2.2）在上、"最新版本"（2.3.0）在下，两个都是壳层给的。
    expect(await screen.findByText("2.3.0")).toBeInTheDocument();
    expect(screen.getByText("2.2.2")).toBeInTheDocument();
    expect(screen.getByText("2026-11-21")).toBeInTheDocument();
    // 壳层有结论时两句占位都不该出现：一句是"上游没给"，一句是"我们没问到"。
    expect(screen.queryByText(t("update.value.noDate"))).toBeNull();
    expect(screen.queryByText(t("update.value.unconfirmed"))).toBeNull();
    expect(screen.queryByText(t("update.desktop.checkFailed"))).toBeNull();
  });

  it("壳层检查失败（后端此时可能正被 403 限流）时说「本次未能确认」，不说「未提供」", async () => {
    mount(snapshot({ phase: "failed", error: "check" }));

    expect(await screen.findByText(t("update.desktop.checkFailed"))).toBeInTheDocument();
    // 版本号与发布时间两列都换成同一句可解释的降级文案。
    expect(screen.getAllByText(t("update.value.unconfirmed"))).toHaveLength(2);
    expect(screen.queryByText(t("update.value.noDate"))).toBeNull();
    // 也没有凭空编出一个版本号。
    expect(screen.queryByText("2.3.0")).toBeNull();
    // 当前版本仍然如实显示（它不是"结论"，不受降级影响）。
    expect(screen.getByText("2.2.2")).toBeInTheDocument();
  });

  it("还没查过时请用户去查，而不是先说「未提供」", async () => {
    mount(snapshot({ phase: "idle" }));

    // 最新版本与发布时间两列都还在等这次检查。
    expect(await screen.findAllByText(t("update.value.checkFirst"))).toHaveLength(2);
    expect(screen.queryByText(t("update.value.noDate"))).toBeNull();
    expect(screen.queryByText(t("update.value.unconfirmed"))).toBeNull();
  });

  it("壳层给了终态但没给发布时间时，仍如实说「未提供」（这一档确实是上游没给）", async () => {
    mount(snapshot({ phase: "available", latest: "2.3.0", published: "" }));

    expect(await screen.findByText("2.3.0")).toBeInTheDocument();
    expect(screen.getByText(t("update.value.noDate"))).toBeInTheDocument();
    expect(screen.queryByText(t("update.value.unconfirmed"))).toBeNull();
  });

  it("壳层说「有新版本」时，卡片复述它的结论与发布说明（与启动弹窗同源）", async () => {
    const body =
      "## 修复\n\n- 改进了更新检查\n\n<details>\n<summary>English</summary>\n\n## Fixes\n\n- better\n</details>";
    mount(
      snapshot({
        phase: "available",
        latest: "2.3.0",
        published: "2026-11-21T00:00:00Z",
        notes: body,
      }),
    );

    // 结论条给出与新版本一致的版本号。
    expect(
      await screen.findByText(t("update.result.available", { version: "2.3.0" })),
    ).toBeInTheDocument();
    // 发布说明来自壳层那一份（`notes`），语言段由 selectReleaseNotes 挑。
    expect(screen.getByText(t("update.notes.title"))).toBeInTheDocument();
  });

  it("壳层说「已是最新」时也直说，不留一个没有结论的空白卡片", async () => {
    mount(snapshot({ phase: "current", latest: "2.2.2", published: "2026-11-01T00:00:00Z" }));

    expect(await screen.findByText(t("update.result.uptodate"))).toBeInTheDocument();
    expect(screen.queryByText(t("update.value.unconfirmed"))).toBeNull();
  });
});
