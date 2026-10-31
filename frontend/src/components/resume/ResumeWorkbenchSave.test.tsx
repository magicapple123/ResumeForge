// SPDX-License-Identifier: Apache-2.0
/**
 * 简历制作台 · 中栏保存的**宿主接线**（v2 文档模型）。
 *
 * 原 v1 版经旧 ResumeZoomModal 壳验证同一行为；旧壳随 v1 链路删除后（Lead 拍板）把这组
 * 行为断言改写到 V2 壳（ResumeWorkbenchV2，经 ResumeDetailPreview 真实宿主挂载）：
 * 1. 中栏改内容 → 顶部「保存修改」→ 宿主收到**当前 v2 文档**（没在表单里的字段不得被清空）；
 * 2. 存完**不关**制作台（用户下一步往往是接着调参数看排版）；
 * 3. 宿主换新 html 重渲染后，主预览与画布一起换、动作条里的简历名跟着换。
 *
 * 断言文案一律走 `t()`：`cjkRatchet` 的 tests 口径按文件卡中文。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import { makeResumeDocument } from "../../test/documentHarness";
import type { ResumeDetail, ResumeDocument, ResumeLayout } from "../../types";
import ResumeDetailPreview from "./ResumeDetailPreview";

vi.mock("../ResumePreview", () => ({
  default: ({ html }: { html: string }) => <div data-testid="preview-html">{html}</div>,
}));
vi.mock("./ResumeLayoutDiagnosisCard", () => ({ default: () => null }));
vi.mock("./ResumeTemplateControls", () => ({ default: () => null }));
vi.mock("./ResumeMeasureControls", () => ({ default: () => null }));
vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
vi.mock("../../api/profile", () => ({
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

const PHOTO = "data:image/png;base64,AAAA";

/** v2 文档：页眉有姓名与照片（照片不在中栏表单里，保存不得把它清空）。 */
function documentWithPhoto(): ResumeDocument {
  const document = makeResumeDocument();
  const name = document.header.items.find((item) => item.key === "name");
  if (name) name.value = "\u5f20\u4e09";
  document.header.items.push({
    kind: "field",
    id: "doc_photo_001",
    key: "photo",
    label: "",
    value: PHOTO,
    placement: "photo",
    format: "text",
  });
  return document;
}

const DETAIL: ResumeDetail = {
  id: 42,
  title: "backend",
  job_id: null,
  job_title: "",
  company: "",
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
  created_at: "2026-09-20T08:00:00",
  content: documentWithPhoto(),
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

const OLD_HTML = "<html><body>old</body></html>";
const NEW_HTML = "<html><body>new</body></html>";

interface RenderOptions {
  detail?: ResumeDetail;
  html?: string;
  onSaveEditedResume?: (content: ResumeDocument) => Promise<void>;
}

function renderPreview({
  detail = DETAIL,
  html = OLD_HTML,
  onSaveEditedResume,
}: RenderOptions = {}) {
  const save = onSaveEditedResume ?? vi.fn(async () => undefined);
  const utils = render(
    <MemoryRouter>
      <AntdApp>
        <ResumeDetailPreview
          detail={detail}
          html={html}
          layout={LAYOUT}
          layoutStatus={null}
          measure={null}
          pdfDirectAvailable
          relayouting={false}
          previewRef={{ current: null }}
          onLayoutStatus={vi.fn()}
          onMeasure={vi.fn()}
          onApplyLayout={vi.fn()}
          onApplyFittedFormat={vi.fn()}
          onSaveEditedResume={save}
          suggestionsGenerated={false}
          suggestionsResetKey={0}
          onSuggestionsGenerated={vi.fn()}
        />
      </AntdApp>
    </MemoryRouter>,
  );
  return { ...utils, save };
}

async function openWorkbench() {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(t("workbench.title")) }));
  await screen.findByRole("dialog", { name: t("workbench.title") });
}

/** V2 中栏的页眉姓名输入（aria-label = 字段目录标签）。 */
function nameInput(): HTMLInputElement {
  return screen.getByRole("textbox", {
    name: t("document.headerField.name"),
  }) as HTMLInputElement;
}

function actionbar(): HTMLElement {
  const node = document.querySelector<HTMLElement>(".resume-wb-actionbar");
  expect(node).not.toBeNull();
  return node as HTMLElement;
}

function saveButton(): HTMLElement {
  return within(actionbar()).getByRole("button", {
    name: new RegExp(t("workbench.action.save-changes")),
  });
}

function headerValue(document: ResumeDocument, key: string): string {
  return document.header.items.find((item) => item.key === key)?.value ?? "";
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("制作台中栏 · 保存落到宿主，预览按新内容重排", () => {
  it("改一条内容 → 保存 → 宿主收到新内容、制作台不关、画布仍是新 html", async () => {
    const { save } = renderPreview();

    await openWorkbench();
    fireEvent.change(nameInput(), { target: { value: "\u674e\u56db" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(save).mock.calls[0][0];
    expect(headerValue(saved, "name")).toBe("\u674e\u56db");
    // 照片不在中栏表单里：保存不能把它清空（与「手动调整」同一条语义）。
    expect(headerValue(saved, "photo")).toBe(PHOTO);
    // 存完**不关**制作台：用户下一步往往是接着调参数看排版。
    expect(screen.getByRole("dialog", { name: t("workbench.title") })).toBeInTheDocument();
  });

  it("宿主 PATCH 完成后用新 html 重渲染：主预览与画布一起换（P0-7）", async () => {
    const { save, rerender } = renderPreview();

    await openWorkbench();
    fireEvent.change(nameInput(), { target: { value: "\u674e\u56db" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    // 宿主的落库链路（PATCH → render → setDetail/setHtml）在父组件里；这里用"换一份
    // detail + html 重渲染"复刻它的结果。
    const updatedDocument = vi.mocked(save).mock.calls[0][0];
    const updated: ResumeDetail = { ...DETAIL, content: updatedDocument };
    rerender(
      <MemoryRouter>
        <AntdApp>
          <ResumeDetailPreview
            detail={updated}
            html={NEW_HTML}
            layout={LAYOUT}
            layoutStatus={null}
            measure={null}
            pdfDirectAvailable
            relayouting={false}
            previewRef={{ current: null }}
            onLayoutStatus={vi.fn()}
            onMeasure={vi.fn()}
            onApplyLayout={vi.fn()}
            onApplyFittedFormat={vi.fn()}
            onSaveEditedResume={save}
            suggestionsGenerated={false}
            suggestionsResetKey={0}
            onSuggestionsGenerated={vi.fn()}
          />
        </AntdApp>
      </MemoryRouter>,
    );

    // 画布（制作台里的那一个）与主预览读的是同一份 html：两个实例都必须是新的。
    await waitFor(() => {
      const instances = screen.getAllByTestId("preview-html");
      expect(instances.length).toBeGreaterThanOrEqual(2);
      expect(instances.every((node) => node.textContent === NEW_HTML)).toBe(true);
    });
    // 制作台动作条里的简历名也跟着换（用户能确认"改的是这一份"）。
    const actionbarName = document.querySelector(".resume-wb-actionbar-name");
    expect(actionbarName?.textContent).toBe(headerValue(updatedDocument, "name"));
  });
});
