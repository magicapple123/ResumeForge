// SPDX-License-Identifier: Apache-2.0
/**
 * W13 命名版本/岗位变体端到端（真实 shell + 真实 HTTP 层）：动作条入口 → 弹层 → 创建 →
 * 比较 → 恢复（条件写）→ 409 不覆盖 → 变体派生/选择性同步。
 *
 * 网络用 fetch 桩按**冻结契约**返回真实形状（不 mock 业务模块）：这样跑过的是
 * `features/resume-versions/versionsApi` → `api/client` → fetch 的真实一层。
 * 服务端真实往返（迁移/不可变/恢复产生新版本）由 backend/tests/test_document_versions.py 覆盖。
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import { CONTENT, LAYOUT, renderModal } from "./ResumeZoomModal.testkit";

vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
vi.mock("../../api/resumes", () => ({
  fetchResumePreviewPdf: vi.fn(() => new Promise(() => undefined)),
}));
vi.mock("../../api/resumeLayout", () => ({
  renderResume: vi.fn(async () => "<!doctype html><html><body></body></html>"),
}));

const VERSION = {
  id: 5,
  resume_id: 42,
  name: "Final draft",
  change_summary: "2 lines added",
  job_id: null,
  job_title: "",
  company: "",
  content_sha256: "abc",
  params_sha256: "def",
  source_revision: 3,
  parent_version_id: null,
  frozen: false,
  source: "manual",
  created_at: "2026-10-20T10:00:00",
};
const VARIANT = {
  id: 9,
  resume_id: 42,
  name: "Backend variant",
  job_id: null,
  job_title: "",
  company: "",
  content_sha256: "aaa",
  base_version_id: null,
  last_synced_version_id: null,
  synced_at: null,
  created_at: "2026-10-20T10:00:00",
  updated_at: "2026-10-20T10:00:00",
};
const COMPARE = {
  base_id: 5,
  against_id: 0,
  base_name: VERSION.name,
  against_name: "current",
  content: {
    base_id: 5,
    against_id: 0,
    base_title: VERSION.name,
    against_title: "current",
    lines: [],
    stats: { added: 1, removed: 0, unchanged: 3 },
  },
  layout: { added: [], removed: [], changed: ["template"], equal: false },
};

interface FetchCall {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

let calls: FetchCall[] = [];
let restoreStatus = 200;

function jsonResponse(payload: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function installFetchStub() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      let body: Record<string, unknown> = {};
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body) as Record<string, unknown>;
        } catch {
          body = {};
        }
      }
      calls.push({ url, method, body });

      if (url.includes("/variants/sync") && method === "POST") {
        return jsonResponse({
          source_version_id: null,
          items: [{ variant_id: 9, applied_paths: ["summary"], content_sha256: "bbb" }],
        });
      }
      if (url.includes("/variants") && method === "POST") {
        return jsonResponse(VARIANT, 201);
      }
      if (url.includes("/variants")) {
        return jsonResponse({ items: [VARIANT] });
      }
      if (url.includes("/restore")) {
        if (restoreStatus === 409) {
          return jsonResponse(
            { detail: "版本已过期", code: "resume_revision_conflict", revision: 12 },
            409,
          );
        }
        return jsonResponse({
          version: VERSION,
          resume: { id: 42, content: { ...CONTENT, name: "Restored" }, revision: 8 },
          revision: 8,
        });
      }
      if (url.includes("/compare/")) return jsonResponse(COMPARE);
      if (url.includes("/versions") && method === "POST") {
        return jsonResponse({ ...VERSION, id: 6, name: "New version" }, 201);
      }
      if (url.includes("/versions")) return jsonResponse({ items: [VERSION] });
      return jsonResponse({});
    }),
  );
}

function renderShell() {
  const onDocumentSynced = vi.fn();
  const view = renderModal({
    documentPipeline: { revision: 7 } as never,
    onDocumentSynced,
    content: CONTENT,
    layout: { ...LAYOUT, format_config: {} },
  });
  return { ...view, onDocumentSynced };
}

async function openVersions(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: t("versions.action.openAria") }));
  return screen.findAllByRole("dialog").then((dialogs) => {
    const dialog = dialogs[dialogs.length - 1];
    if (!dialog) throw new Error("versions dialog not rendered");
    return dialog;
  });
}

/** antd 在两个汉字的按钮里会插空格（"比 较" / "恢 复"）。 */
function looseName(label: string): RegExp {
  return new RegExp("^" + label.split("").join("\\s*") + "$");
}

beforeEach(() => {
  calls = [];
  restoreStatus = 200;
  installFetchStub();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("W13 版本与变体端到端（真实 shell + API 层）", () => {
  it("动作条入口 → 列表 → 创建版本（真实 POST 请求体）", async () => {
    renderShell();
    const dialog = await openVersions();
    expect(await within(dialog).findByText(VERSION.name)).toBeInTheDocument();
    // 创建版本：真实 POST /resumes/42/versions。
    const nameInput = within(dialog).getByRole("textbox", { name: t("versions.create.name") });
    fireEvent.change(nameInput, { target: { value: "New version" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("versions.create.action") }));
    await waitFor(() => {
      const post = calls.find(
        (call) => call.method === "POST" && /\/resumes\/42\/versions$/.test(call.url),
      );
      expect(post).toBeTruthy();
    });
    const post = calls.find(
      (call) => call.method === "POST" && /\/resumes\/42\/versions$/.test(call.url),
    );
    expect(post?.body).toEqual({ name: "New version", change_summary: "" });
  });

  it("比较：真实 GET compare/current，并渲染正文/排版摘要", async () => {
    renderShell();
    const dialog = await openVersions();
    await within(dialog).findByText(VERSION.name);
    fireEvent.click(
      within(dialog).getByRole("button", { name: looseName(t("versions.action.compare")) }),
    );
    await waitFor(() =>
      expect(calls.some((call) => /\/versions\/5\/compare\/current$/.test(call.url))).toBe(true),
    );
    expect(
      await within(dialog).findByText(t("versions.compare.contentStats", { added: 1, removed: 0 })),
    ).toBeInTheDocument();
  });

  it("恢复：条件写带 expected_revision；成功回写宿主刷新（onDocumentSynced）", async () => {
    const { onDocumentSynced } = renderShell();
    const dialog = await openVersions();
    await within(dialog).findByText(VERSION.name);
    fireEvent.click(
      await within(dialog).findByRole("button", {
        name: new RegExp("^" + t("versions.action.restore") + "$"),
      }),
    );
    // Popconfirm 的确认按钮挂在 body 级 portal，不在弹窗 DOM 内。
    const confirms = await screen.findAllByRole("button", {
      name: looseName(t("versions.restore.ok")),
    });
    fireEvent.click(confirms[confirms.length - 1]);
    await waitFor(() => {
      const restore = calls.find((call) => /\/restore$/.test(call.url));
      expect(restore?.body).toEqual({ expected_revision: 7 });
    });
    await waitFor(() => expect(onDocumentSynced).toHaveBeenCalledTimes(1));
    // 宿主收到的是恢复后的 resume 快照（由 shell 交给宿主刷新 detail/html/revision）。
    expect(onDocumentSynced.mock.calls[0][0]).toMatchObject({ id: 42, revision: 8 });
  });

  it("409 冲突：只提示刷新，不再发第二次 restore（不自动覆盖）", async () => {
    restoreStatus = 409;
    renderShell();
    const dialog = await openVersions();
    await within(dialog).findByText(VERSION.name);
    fireEvent.click(
      await within(dialog).findByRole("button", {
        name: new RegExp("^" + t("versions.action.restore") + "$"),
      }),
    );
    // Popconfirm 的确认按钮挂在 body 级 portal，不在弹窗 DOM 内。
    const confirms = await screen.findAllByRole("button", {
      name: looseName(t("versions.restore.ok")),
    });
    fireEvent.click(confirms[confirms.length - 1]);
    expect(await within(dialog).findByText(t("versions.restore.conflict"))).toBeInTheDocument();
    expect(calls.filter((call) => /\/restore$/.test(call.url))).toHaveLength(1);
  });

  it("岗位变体：派生（POST /variants）+ 选择性同步只提交勾选变体与路径", async () => {
    renderShell();
    const dialog = await openVersions();
    fireEvent.click(within(dialog).getByRole("tab", { name: t("versions.tab.variants") }));
    expect((await within(dialog).findAllByText(VARIANT.name)).length).toBeGreaterThan(0);

    const nameInput = within(dialog).getByRole("textbox", {
      name: t("versions.variants.create.name"),
    });
    fireEvent.change(nameInput, { target: { value: "Backend variant 2" } });
    fireEvent.click(
      within(dialog).getByRole("button", { name: t("versions.variants.create.action") }),
    );
    await waitFor(() =>
      expect(
        calls.some((call) => call.method === "POST" && /\/resumes\/42\/variants$/.test(call.url)),
      ).toBe(true),
    );

    const variantChecks = within(dialog).getAllByRole("checkbox", { name: VARIANT.name });
    fireEvent.click(variantChecks[0]);
    // 分组标题与首条选项同名（都叫 summary）：点分组标题 = 勾整组。
    const summaryChecks = within(dialog).getAllByRole("checkbox", { name: "summary" });
    fireEvent.click(summaryChecks[0]);
    fireEvent.click(
      within(dialog).getByRole("button", { name: t("versions.variants.syncAction") }),
    );
    await waitFor(() => {
      const sync = calls.find((call) => /\/variants\/sync$/.test(call.url));
      expect(sync?.body).toEqual({
        source_version_id: null,
        variant_ids: [9],
        paths: ["summary"],
      });
    });
  });
});
