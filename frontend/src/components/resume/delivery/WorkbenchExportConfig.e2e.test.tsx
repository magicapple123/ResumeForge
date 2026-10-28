// SPDX-License-Identifier: Apache-2.0
/**
 * W19 端到端（真实 shell + 真实 HTTP 层）：制作台动作条「导出」→「导出交付包」弹层 →
 * 配置/核对/导出请求带 revision → 409 版本冲突 → 点「刷新并核对」走 onReloadRevision。
 *
 * 网络用 fetch 桩按 wave2 §6 契约返回真实形状：跑过的是 ResumeDetailPreview → ExportConfigModal →
 * features/resume-delivery（真适配层）→ api/client → fetch 这一整层，只替换传输端。
 * 真实后端（zip/manifest/归档）由 W19-BE 落地后的真实往返覆盖，不在本文件伪造。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { TEMPLATE_CATALOG } from "../../../test/resumeFixtures";
import type { ResumeDetail, ResumeLayout } from "../../../types";
import ResumeDetailPreview from "../ResumeDetailPreview";

vi.mock("../../ResumePreview", () => ({
  default: ({ html }: { html: string }) => <div data-testid="preview-html">{html}</div>,
}));
vi.mock("../../ResumeLayoutDiagnosisCard", () => ({ default: () => null }));
vi.mock("../../ResumeTemplateControls", () => ({ default: () => null }));
vi.mock("../../ResumeMeasureControls", () => ({ default: () => null }));
vi.mock("../../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
vi.mock("../../../api/profile", () => ({
  getProfile: vi.fn(async () => ({
    photo: "",
    name: "",
    gender: "",
    birth_year: "",
    phone: "",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "",
    summary: "",
    educations: [],
    experiences: [],
    campus_experiences: [],
    projects: [],
    skills: [],
    awards: [],
  })),
}));
// 不 mock api/resumes：409 后 onReloadRevision 走真实 getResume → api/client → fetch 桩。

const DETAIL: ResumeDetail = {
  id: 42,
  title: "后端开发-示例科技",
  job_id: 7,
  job_title: "后端开发",
  company: "示例科技",
  source: "ai",
  favorite: false,
  note: "",
  model: "demo-model",
  enhancement_enabled: false,
  enhancement_level: "balanced",
  template: "classic",
  format_name: "",
  format_config: {},
  page_limit: 1,
  font_scale: "standard",
  created_at: "2026-10-20T08:00:00",
  content: {
    photo: "",
    name: "张三",
    gender: "",
    birth_year: "",
    phone: "13800000000",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "",
    summary: "",
    education: [],
    experience: [],
    campus_experience: [],
    projects: [],
    skills: [],
    awards: [],
  },
  warnings: [],
  parse_error: "",
  rationale: "",
  parent_revision_id: null,
  coverage_notes: [],
};

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  format_config: {},
};

interface FetchCall {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

let calls: FetchCall[] = [];
let bundleStatus: 200 | 409 = 200;

function jsonResponse(payload: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function installFetchStub(): void {
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
      if (url.includes("/export-presets")) return jsonResponse({ items: [] });
      if (url.includes("/export-bundle")) {
        if (bundleStatus === 409) {
          // 真实后端把业务码包在 detail 里（contract §4）；这里用同样的嵌套形状，
          // 保证适配层的 toRevisionChangedError 走的是真实分支。
          return jsonResponse(
            {
              detail: {
                detail: "简历版本已变化，请刷新后再导出",
                code: "resume_revision_changed",
                revision: 9,
              },
            },
            409,
          );
        }
        return Promise.resolve(
          new Response(new Blob(["zip"]), {
            status: 200,
            headers: {
              "Content-Type": "application/zip",
              "Content-Disposition": 'attachment; filename="resume-bundle.zip"',
            },
          }),
        );
      }
      if (method === "GET" && /\/resumes\/42$/.test(url)) {
        return jsonResponse({ id: 42, revision: 8 });
      }
      return jsonResponse({});
    }),
  );
}

function renderPreview(layout: ResumeLayout = LAYOUT) {
  return render(
    <MemoryRouter>
      <AntdApp>
        <ResumeDetailPreview
          detail={DETAIL}
          html="<html><body>preview</body></html>"
          layout={layout}
          layoutStatus={null}
          measure={null}
          pdfDirectAvailable
          relayouting={false}
          previewRef={{ current: null }}
          onLayoutStatus={vi.fn()}
          onMeasure={vi.fn()}
          onApplyLayout={vi.fn()}
          onApplyFittedFormat={vi.fn()}
          onSaveEditedResume={vi.fn(async () => undefined)}
          suggestionsGenerated={false}
          suggestionsResetKey={0}
          onSuggestionsGenerated={vi.fn()}
          documentPipeline={{ revision: 7 } as never}
        />
      </AntdApp>
    </MemoryRouter>,
  );
}

function looseName(label: string): RegExp {
  return new RegExp(label.replace(/\s/g, "").split("").join("\\s*"));
}

function button(scope: HTMLElement, label: string): HTMLElement {
  return within(scope).getByRole("button", { name: looseName(label) });
}

async function openWorkbench(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(t("workbench.title")) }));
  await screen.findByRole("dialog", { name: t("workbench.title") });
}

function actionbar(): HTMLElement {
  const node = document.querySelector<HTMLElement>(".resume-wb-actionbar");
  if (!node) throw new Error("workbench action bar not found");
  return node;
}

async function openExportDialog(): Promise<HTMLElement> {
  await openWorkbench();
  fireEvent.click(button(actionbar(), t("export.action.export")));
  let found: HTMLElement | null = null;
  await waitFor(() => {
    const dialogs = screen.queryAllByRole("dialog");
    // 标题与主按钮文案相同（都是「导出交付包」），所以用 queryAllByText 判存在，
    // 用 queryByText 会在弹层内命中两处而抛 "Found multiple elements"。
    const candidate = dialogs.find(
      (dialog) => within(dialog).queryAllByText(t("delivery.config.title")).length > 0,
    );
    if (!candidate) throw new Error("export dialog not open yet (dialogs=" + dialogs.length + ")");
    found = candidate;
  });
  if (!found) throw new Error("export dialog not found");
  await within(found).findByText(t("delivery.check.title"));
  return found;
}

beforeEach(() => {
  calls = [];
  bundleStatus = 200;
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

describe("W19 制作台导出交付包端到端（真实 shell + HTTP 适配层）", () => {
  it("动作条入口打开弹层；核对与导出请求都带当前 revision；导出成功不关制作台", async () => {
    renderPreview();
    const dialog = await openExportDialog();

    // D20：打开弹层即按导出同一快照请求服务端核对（purpose:"export"）。本桩没有返回
    // export_summary（模拟旧后端），适配层 feature-detect 回退本地，并在卡片如实标注来源。
    await waitFor(() => {
      const check = calls.find((call) => call.url.includes("/preflight"));
      expect(check?.body).toMatchObject({
        purpose: "export",
        layout: { template: "classic", page_limit: 1 },
      });
    });
    expect(await within(dialog).findByText(t("delivery.check.source.local"))).toBeInTheDocument();
    expect(await within(dialog).findByText("#7")).toBeInTheDocument();

    fireEvent.click(button(dialog, t("delivery.export.action")));
    await waitFor(() => {
      const bundle = calls.find((call) => call.url.includes("/export-bundle"));
      expect(bundle?.body).toMatchObject({
        formats: ["pdf"],
        resume_revision: 7,
        strict_revision: true,
      });
      // 同快照：草稿正文随请求发（后端不落库、不冻结）。
      expect((bundle?.body.content as { name?: string } | undefined)?.name).toBe("张三");
    });
    // 导出后仍在制作台：不把用户踢回主预览界面。
    // 用 queryAll 判存在：antd 叠层时同一标题会出现在多个 dialog 节点上。
    expect(screen.queryAllByRole("dialog", { name: t("workbench.title") }).length).toBeGreaterThan(
      0,
    );
  });

  it("导出请求带全 format_config（联系方式换行等布局覆盖不被丢掉）", async () => {
    // #3 用户反馈回归：制作台里设了「联系方式换行」后导出的 Word 没有换行。
    // 第一段证据在这里：导出弹窗必须把**当前整份 format_config** 原样塞进成套导出请求
    // （后端 Word 渲染读的正是其中的 contact_breaks）；漏带它时后端只能回落记录值。
    const withBreaks: ResumeLayout = {
      ...LAYOUT,
      format_config: { contact_breaks: ["personal_website"], accent: "#123456" },
    };
    renderPreview(withBreaks);
    const dialog = await openExportDialog();

    fireEvent.click(button(dialog, t("delivery.export.action")));
    await waitFor(() => {
      const bundle = calls.find((call) => call.url.includes("/export-bundle"));
      expect(bundle?.body.format_config).toEqual({
        contact_breaks: ["personal_website"],
        accent: "#123456",
      });
    });
  });

  it("409 版本已更新：提示 + 不自动重试；点「刷新并核对」走 onReloadRevision 重取 revision", async () => {
    bundleStatus = 409;
    renderPreview();
    const dialog = await openExportDialog();

    fireEvent.click(button(dialog, t("delivery.export.action")));
    expect(await within(dialog).findByText(t("delivery.revision.title"))).toBeInTheDocument();
    // 不自动重试：只打过一次 bundle。
    await waitFor(() =>
      expect(calls.filter((call) => call.url.includes("/export-bundle"))).toHaveLength(1),
    );

    fireEvent.click(button(dialog, t("delivery.revision.refresh")));
    // 刷新 = 宿主 onReloadRevision 重取 revision（GET /resumes/42）；核对摘要按新 revision 重算。
    await waitFor(() =>
      expect(calls.some((call) => call.method === "GET" && /\/resumes\/42$/.test(call.url))).toBe(
        true,
      ),
    );
    expect(screen.queryAllByRole("dialog", { name: t("workbench.title") }).length).toBeGreaterThan(
      0,
    );
  });
});
