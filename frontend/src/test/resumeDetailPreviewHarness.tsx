// SPDX-License-Identifier: Apache-2.0
/**
 * `ResumeDetailPreview` 测试共用的夹具、渲染脚手架与 CSS 断言辅助。
 *
 * 2026-11（行数预算）：`ResumeDetailPreview.test.tsx` 逼近 500 行测试预算，而这里的东西
 * 与"测的是哪个行为"无关——一份详情夹具、两条渲染入口（原样 / 带覆盖）、以及从
 * `resume-panels.css` 原文里取某条规则声明区的三个小函数。抽出来之后用例文件只剩断言。
 *
 * 约定与 `src/test/trackerPageHarness.tsx` 一致：**不带 `.test.` 后缀**（不会被 vitest
 * 收集），放在 `src/test/` 下（不进 i18n 棘轮与产品文案扫描的统计口径）。
 * `vi.mock` 声明仍留在各测试文件内——vitest 的 mock 注册是文件级的，搬走会失效。
 */
import { App as AntdApp } from "antd";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import type { ResumeDetail, ResumeLayout } from "../types";
import ResumeDetailPreview from "../components/resume/ResumeDetailPreview";

/**
 * 「从我的资料填入」的候选来自 `/profile`：这条入口是**按需**取的（打开编辑器/制作台才
 * 请求），所以测试文件既要钉住"什么时候请求"，也要钉住"请求失败不能挡住编辑器"。
 * 只需要让 `profileToResumeContent` 走得通：六个列表给空数组，个人总结非空即可。
 */
export const PROFILE = {
  photo: "",
  name: "张三",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  personal_website: "",
  github: "",
  job_intent: "",
  summary: "Backend engineer, five years.",
  educations: [],
  experiences: [],
  campus_experiences: [],
  projects: [],
  skills: [],
  awards: [],
};

export const DETAIL: ResumeDetail = {
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
  created_at: "2026-09-20T08:00:00",
  content: {
    photo: "",
    name: "张三",
    gender: "",
    birth_year: "",
    phone: "",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "后端开发",
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

export const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  format_config: {},
};

/** 渲染默认夹具（`extraActions` 用来验底部确认行）。 */
export function renderPreview(extraActions?: ReactNode) {
  const previewRef = { current: null };
  return render(
    <MemoryRouter>
      <AntdApp>
        <ResumeDetailPreview
          detail={DETAIL}
          html="<html></html>"
          layout={LAYOUT}
          layoutStatus={null}
          measure={null}
          pdfDirectAvailable
          relayouting={false}
          previewRef={previewRef}
          onLayoutStatus={vi.fn()}
          onMeasure={vi.fn()}
          onApplyLayout={vi.fn()}
          onApplyFittedFormat={vi.fn()}
          onSaveEditedResume={vi.fn()}
          extraActions={extraActions}
          suggestionsGenerated={false}
          suggestionsResetKey={0}
          onSuggestionsGenerated={vi.fn()}
        />
      </AntdApp>
    </MemoryRouter>,
  );
}

export function detailWith(overrides: Partial<ResumeDetail>): ResumeDetail {
  return {
    ...DETAIL,
    ...overrides,
    content: { ...DETAIL.content, ...overrides.content },
  };
}

/** 渲染带覆盖的详情：正文分组只关心 `rationale` / `coverage_notes` / `warnings`。 */
export function renderPreviewWith(overrides: Partial<ResumeDetail>) {
  const previewRef = { current: null };
  return render(
    <MemoryRouter>
      <AntdApp>
        <ResumeDetailPreview
          detail={detailWith(overrides)}
          html="<html></html>"
          layout={LAYOUT}
          layoutStatus={null}
          measure={null}
          pdfDirectAvailable
          relayouting={false}
          previewRef={previewRef}
          onLayoutStatus={vi.fn()}
          onMeasure={vi.fn()}
          onApplyLayout={vi.fn()}
          onApplyFittedFormat={vi.fn()}
          onSaveEditedResume={vi.fn()}
          suggestionsGenerated={false}
          suggestionsResetKey={0}
          onSuggestionsGenerated={vi.fn()}
          onResumeRevised={vi.fn()}
        />
      </AntdApp>
    </MemoryRouter>,
  );
}

/**
 * 剥掉 CSS 注释，**保留换行**（多行注释换成等量空行，出错时还能按行号回读原文）。
 *
 * 为什么要剥：`resume-panels.css` 的历史注释里逐字写着"这里原来是 `grid-column: 4 / -1`"
 * 这类**旧写法**。断言若不剥注释，就会把"注解"当成"规则"——取声明区时会取到注释里的
 * 字面量，反例守卫也会被注释本身命中，变成一条永远红的假警报（比漏报更坏：它会训练
 * 后来的人直接删掉守卫）。
 *
 * CSS 没有行注释，只有块注释（`/*` 开头、星号加斜杠结尾），一条非贪婪正则够用；
 * 非贪婪是必须的——贪婪会把两段注释并成一段，中间的**真规则**一起被吃掉。
 */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""));
}

/** 选择器归一化：把折行/多空格压成单空格，才能与调用处写的字面量逐字比较。 */
export function normalizeSelector(selector: string): string {
  return selector.replace(/\s+/g, " ").trim();
}

/**
 * 取某个选择器的**声明区**（规则块里 `{` 与 `}` 之间的原文）。
 *
 * - **先剥注释再匹配**：理由见 `stripCssComments`。
 * - 选择器可以出现在逗号列表里：`.a,\n.b { … }` 对 `.a` 与 `.b` 返回同一份声明区
 *   （尾行的右侧动作组正是这么写的：确认行与只有导出时共用一条规则）。
 * - 必须是**整项相等**：`".resume-detail-footer-tail"` 不能命中
 *   `".resume-detail-footer-tail > .ant-btn"`，否则"尾行自己换行"会拿子按钮的规则自证。
 * - 命中多条时返回**第一条**：媒体查询里的覆盖写在文件末尾，不参与基础规则断言。
 * - **找不到就返回空串**（不 `throw`）：调用处的 `toContain` 会直接失败并指出缺了哪条，
 *   而 `throw` 会把整个文件的用例一起带挂，掩盖掉其它真实失败。
 */
export function cssDeclarations(css: string, selector: string): string {
  const source = stripCssComments(css);
  const wanted = normalizeSelector(selector);
  // 选择器与声明区都不允许跨过花括号：一条正则就能切出所有扁平规则，
  // `@media` 里的规则因为是内层扁平块，同样会被切到（返回时取第一条，见上）。
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null = rule.exec(source);
  while (match !== null) {
    const selectors = match[1].split(",").map(normalizeSelector);
    if (selectors.includes(wanted)) return match[2].trim();
    match = rule.exec(source);
  }
  return "";
}

/** 每个用例之后清 DOM（三条缺一条都会让下一条读到上一条的浮层节点）。 */
export function resetResumeDetailDom(): void {
  cleanup();
  document.body.innerHTML = "";
}
