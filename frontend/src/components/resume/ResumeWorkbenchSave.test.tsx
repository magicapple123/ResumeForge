// SPDX-License-Identifier: Apache-2.0
/**
 * 简历制作台 · 中栏保存的**宿主接线**（P0-3 / P0-7 的最后一段）。
 *
 * 中栏自己那一层（脏值、三个出口、不关面板）由 `ResumeWorkbenchEditorColumn.test.tsx` 钉住；
 * 这里补的是它**上面**那一层：宿主要把中栏的保存接到既有的落库链路（PATCH → 重渲染 →
 * `detail.html` 换新），右栏画布再按新 html 重排——这是"改一句措辞就能看到版面变化"的闭环，
 * 也是 PRD 里唯一可度量的目标（跳窗次数 2 → 0）。
 *
 * 为什么必须在调用点这一层测：`ResumeZoomModal` 只要漏传 `onSaveContent`，中栏就整体不渲染，
 * 组件级用例照样全绿；`onSaveContent` 接错一根线（比如接成 `onSave` 之外的东西），表现是
 * "点了保存什么都没发生"。两种失效都只有在这里能看见。
 *
 * 断言文案一律走 `t()`：`cjkRatchet` 的 tests 口径逐文件卡中文 `getByText`，新文件基线为 0。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import type { ResumeDetail, ResumeLayout } from "../../types";
import ResumeDetailPreview from "./ResumeDetailPreview";

/**
 * 预览桩：把收到的 `html` 原样渲染出来。
 *
 * 本轮要证明的正是"宿主换了 html 之后，画布与主预览都跟着换"——真实 `ResumePreview` 走
 * iframe，jsdom 里读不到结果，所以这里只保留这根数据线。
 */
vi.mock("../ResumePreview", () => ({
  default: ({ html }: { html: string }) => <div data-testid="preview-html">{html}</div>,
}));
vi.mock("./ResumeLayoutDiagnosisCard", () => ({ default: () => null }));
vi.mock("./ResumeTemplateControls", () => ({ default: () => null }));
vi.mock("./ResumeMeasureControls", () => ({ default: () => null }));
vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
// 中栏会按需取「我的资料」候选：让它成功返回空资料，避免用例被无关请求干扰。
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
  content: {
    photo: "data:image/png;base64,AAAA",
    name: "张三",
    gender: "",
    birth_year: "",
    phone: "",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "",
    summary: "",
    education: [],
    experience: [
      {
        company: "字节跳动",
        role: "工程师",
        start_date: "",
        end_date: "",
        description: ["实现检索接口"],
      },
    ],
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

const OLD_HTML = "<html><body>old</body></html>";
const NEW_HTML = "<html><body>new</body></html>";

interface RenderOptions {
  detail?: ResumeDetail;
  html?: string;
  onSaveEditedResume?: (content: ResumeDetail["content"]) => Promise<void>;
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

/** 打开制作台：底栏那颗按钮的文案就是弹窗标题（`workbench.title`）。 */
async function openWorkbench() {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(t("workbench.title")) }));
  await screen.findByRole("dialog", { name: t("workbench.title") });
}

function nameInput(): HTMLInputElement {
  const input = document.getElementById("name");
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

/**
 * 顶部动作条里的「保存修改」（2026-11 起这是制作台**唯一**的保存入口）。
 *
 * 中栏底部那一对「保存内容 / 放弃修改」已在制作台里摘掉（`hideActions`）：一份改动
 * 却有两个"保存"按钮，用户得先判断它们管的是不是同一件事。带图标，所以可访问名是
 * 「icon label + 文案」，按子串匹配。
 */
function saveButton(): HTMLElement {
  return within(actionbar()).getByRole("button", {
    name: new RegExp(t("workbench.action.save-changes")),
  });
}

/** 制作台顶部动作条（按钮已经不在中栏底部了）。 */
function actionbar(): HTMLElement {
  const node = document.querySelector<HTMLElement>(".resume-wb-actionbar");
  expect(node).not.toBeNull();
  return node as HTMLElement;
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
    fireEvent.change(nameInput(), { target: { value: "李四" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(save).mock.calls[0][0];
    expect(saved.name).toBe("李四");
    // 照片不在中栏表单里：保存不能把它清空（与「手动调整」同一条语义）。
    expect(saved.photo).toBe(DETAIL.content.photo);
    // 存完**不关**制作台：用户下一步往往是接着调参数看排版。
    expect(screen.getByRole("dialog", { name: t("workbench.title") })).toBeInTheDocument();
  });

  it("宿主 PATCH 完成后用新 html 重渲染：主预览与画布一起换（P0-7）", async () => {
    const { save, rerender } = renderPreview();

    await openWorkbench();
    fireEvent.change(nameInput(), { target: { value: "李四" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    // 宿主的落库链路（`saveEditedResume`：PATCH → render → setDetail/setHtml）在父组件里，
    // 这里用"换一份 detail + html 重渲染"复刻它的结果。
    const updated: ResumeDetail = {
      ...DETAIL,
      content: { ...DETAIL.content, name: "李四" },
    };
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
    // 制作台标题行里的简历名也跟着换（用户能确认"改的是这一份"）。
    // 不用 `getByText`：`cjkRatchet` 的 tests 口径按文件卡中文断言，新文件基线为 0。
    const actionbarName = document.querySelector(".resume-wb-actionbar-name");
    expect(actionbarName?.textContent).toBe(updated.content.name);
  });
});
