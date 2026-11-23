// SPDX-License-Identifier: Apache-2.0
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectReleaseNotes } from "../settings/updateCardHelpers";
import { renderReleaseNotes } from "../settings/updateNotesRenderer";
import UpdateCard from "../settings/UpdateCard";
import StartupUpdatePrompt from "./StartupUpdatePrompt";
import { selectLocale } from "../../i18n/localeStore";
import I18nProvider from "../../i18n/I18nProvider";
import { t } from "../../i18n";
import type { DesktopUpdateState, InAppUpdateBridge } from "./desktopUpdateBridge";
import { skipVersion } from "./updatePreferences";

const english = "## Fixes\n\n- Changed **Windows** updates.";
const chinese = "## 修复\n\n- 改进了 **Windows** 更新";
const body = english + "\n\n<details>\n<summary>中文版</summary>\n\n" + chinese + "\n</details>";

describe("published bilingual Markdown", () => {
  it("renders inline code and links inside bold release text without consuming the next token", () => {
    const markdown =
      "**`update_check` / `update_download` 作为进程第一个 import 时失败（2.2.2 引入）。** " +
      "**Read the [`guide`](https://example.org/guide) and `x**y`**. " +
      "[**`appendix`**](https://example.org/appendix) [`plain`](data:text/plain,hidden) `**literal**`";
    const { container } = render(<>{renderReleaseNotes(markdown)}</>);
    const bold = container.querySelectorAll("strong");
    expect(Array.from(bold[0].querySelectorAll("code"), (node) => node.textContent)).toEqual([
      "update_check",
      "update_download",
    ]);
    expect(bold[1].querySelector("a > code")?.textContent).toBe("guide");
    expect(bold[1].textContent).toContain("x**y");
    expect(container.querySelector("a > strong > code")?.textContent).toBe("appendix");
    expect(container.querySelectorAll("a")).toHaveLength(2);
    expect(container).not.toHaveTextContent("data:text");
    expect(Array.from(container.querySelectorAll("code"), (node) => node.textContent)).toContain(
      "**literal**",
    );
  });
  it("selects the interface language before rendering headings and lists", () => {
    expect(selectReleaseNotes(body, "zh-CN")).toBe(chinese);
    expect(selectReleaseNotes(body, "en-US")).toBe(english);
    const reverse =
      chinese + "\n<details open><summary>English</summary>\n" + english + "\n</details>";
    expect(selectReleaseNotes(reverse, "en-US")).toBe(english);
    expect(selectReleaseNotes(reverse, "zh-CN")).toBe(chinese);
    expect(selectReleaseNotes(english, "zh-CN", true)).toBe("");
    expect(selectReleaseNotes(chinese, "en-US", true)).toBe("");
  });
  it("never leaves a tag fragment in the output when the summary is malformed", () => {
    // CodeQL #136 `js/incomplete-multi-character-sanitization`：以前这里先把 summary
    // 用一次 `/<[^>]*>/g` 剥标签，而 `<<script` 这种没有 `>` 收尾的残片一个字符都不
    // 匹配，剥完仍是 `<<script`——输出里照样留着 `<script`。现在语言判断直接对原始
    // label 做，拼回正文时改用单字符 `/[<>]/g`（只能删，不可能拼出新的尖括号）。
    const notes = "<details><summary><<script</summary>\n\n正文段落\n</details>";

    const out = selectReleaseNotes(notes, "zh-CN");

    expect(out).not.toContain("<script");
    expect(out).toContain("正文段落");
  });
  it("still detects the language when the summary carries inline markup", () => {
    // 语义不许因为"不再剥标签"而变：`<summary>` 里的 `<code>` 之类行内标记不该
    // 影响语言判断（旧实现是先剥再判，剥完是 `中文版`，同样判成 zh-CN）。
    const withCode =
      english +
      "\n<details>\n<summary><code>中文版</code></summary>\n\n" +
      chinese +
      "\n</details>";

    expect(selectReleaseNotes(withCode, "zh-CN")).toBe(chinese);
    const reverse =
      chinese +
      "\n<details>\n<summary><code>English</code></summary>\n\n" +
      english +
      "\n</details>";
    expect(selectReleaseNotes(reverse, "en-US")).toBe(english);
  });
});

const idle: DesktopUpdateState = {
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
  sequence: 0,
  error: "",
  errorDetail: "",
};
function mount(initial = idle) {
  let state = initial;
  const listeners = new Set<(next: DesktopUpdateState) => void>();
  const send = (fields: Partial<DesktopUpdateState>) => {
    state = { ...state, ...fields, sequence: state.sequence + 1 };
    listeners.forEach((fn) => fn(state));
  };
  const bridge: InAppUpdateBridge = {
    getUpdateState: async () => state,
    onUpdateState: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    checkUpdate: vi.fn(async () => {
      send({
        phase: state.phase === "downloading" ? "downloading" : "available",
        manual: true,
        latest: "2.2.3",
        notes: body,
        request: state.request + 1,
      });
      return { ok: true };
    }),
    startUpdate: vi.fn(async () => {
      send({ phase: "downloading" });
      return true;
    }),
  };
  vi.stubGlobal("rfDesktop", bridge);
  render(
    <I18nProvider>
      <StartupUpdatePrompt />
      <UpdateCard />
    </I18nProvider>,
  );
  return { send, bridge };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  selectLocale("zh-CN");
});

it("opens one notice from Settings, switches language, and resumes hidden download progress", async () => {
  const { bridge, send } = mount();
  fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: "修复" })).toBeInTheDocument();
  expect(within(dialog).queryByText("Fixes")).toBeNull();
  act(() => {
    selectLocale("en-US");
  });
  expect(within(dialog).getByRole("heading", { name: "Fixes" })).toBeInTheDocument();
  expect(dialog).not.toHaveTextContent("<details>");
  fireEvent.click(within(dialog).getByRole("button", { name: "Update now" }));
  expect(bridge.startUpdate).toHaveBeenCalledWith("2.2.3");
  expect(await within(dialog).findByText("Downloading the installer")).toBeInTheDocument();
  act(() => send({ received: 60, total: 100 }));
  expect(dialog).toHaveTextContent("60%");
  fireEvent.click(within(dialog).getByRole("button", { name: "Hide" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "View update progress" }));
  expect(await screen.findByRole("dialog")).toHaveTextContent("60%");
  act(() => send({ phase: "verifying" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Verifying the installer");
  act(() => send({ phase: "installing" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Restarting to install");
  expect(bridge.startUpdate).toHaveBeenCalledTimes(1);
});

it("respects a skipped automatic offer and lets a manual check open it", async () => {
  skipVersion("2.2.3");
  const { send } = mount();
  act(() => send({ phase: "available", latest: "2.2.3", notes: body, request: 1 }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
  expect(await screen.findByRole("dialog")).toHaveTextContent("2.2.3");
  act(() => send({ phase: "failed", error: "incomplete" }));
  expect(screen.getByText(t("update.inApp.incomplete"))).toBeInTheDocument();
});

// ── 失败原因（第 11 条）───────────────────────────────────────────────
// 以前主进程把 `err.message` 丢了，弹窗里只剩固定文案；这三条钉住三件事：
// 有原因要显示（并保留原文）、没原因不许留空描述、按钮失败要按动作说。

it("shows the attributed reason and keeps the original message on screen", async () => {
  const { send } = mount();
  const detail = "releases/latest returned 403 (x-ratelimit-remaining: 0)";
  act(() =>
    send({ phase: "failed", error: "check", errorDetail: detail, manual: true, request: 1 }),
  );
  const dialog = await screen.findByRole("dialog");
  const alert = within(dialog).getByRole("alert");
  expect(alert.textContent).toContain(t("update.error.check"));
  // 归因（额度用完）与原文括注都在：原文是用户反馈问题时要贴出来的证据。
  expect(alert.textContent).toContain(t("update.error.why.quota"));
  expect(alert.textContent).toContain(detail);
});

it("renders only the fixed line when the main process had no reason", async () => {
  const { send } = mount();
  act(() => send({ phase: "failed", error: "check", errorDetail: "", manual: true, request: 1 }));
  const dialog = await screen.findByRole("dialog");
  // 空描述会在 Alert 里留下一条空白行：这里用"整段文本恰好等于标题"钉住它不许出现。
  expect(within(dialog).getByRole("alert").textContent).toBe(t("update.error.check"));
});

it("names the action that failed: a failed recheck never says install", async () => {
  const { bridge, send } = mount();
  bridge.checkUpdate = vi.fn(async () => ({ ok: false, error: "untrusted sender" }));
  // 用 download 阶段码做底色，标题于是是「下载更新失败」，与「检查更新失败」不会混淆。
  act(() => send({ phase: "failed", error: "download", manual: true, request: 1 }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: t("update.action.recheck") }));
  await waitFor(() =>
    expect(within(dialog).getByText(t("update.error.check"))).toBeInTheDocument(),
  );
  expect(within(dialog).queryByText(t("update.error.install"))).toBeNull();
  expect(dialog).toHaveTextContent("untrusted sender");
});

it("names the action that failed: a failed install says install", async () => {
  const { bridge, send } = mount();
  bridge.startUpdate = vi.fn(async () => false);
  act(() => send({ phase: "available", latest: "2.2.3", notes: body, manual: true, request: 1 }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: t("update.startup.updateNow") }));
  await waitFor(() =>
    expect(within(dialog).getByText(t("update.error.install"))).toBeInTheDocument(),
  );
  expect(within(dialog).queryByText(t("update.error.check"))).toBeNull();
});
