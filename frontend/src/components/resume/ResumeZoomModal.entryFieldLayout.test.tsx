// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台「条目级字段排版」的**端到端可达性**回归（2026-11 用户实测缺陷）。
 *
 * ## 被钉住的缺陷
 *
 * 用户：排版参数 → 条目字段排版 → 分区选「教育经历」→ 条目选「上海大学」→ 每行字段数 3 列，
 * 面板显示「正在单独设置：上海大学」，右栏纸面仍是"每行一个字段"。
 *
 * 根因是**同一份正文补出了两套条目 id**：
 * - 面板的条目下拉取 `identifiedContent`（`ensureEntryIds` 补过 id 的那一份），写进
 *   `format_config.field_layout.entries.<id>` 的就是这一套；
 * - 但右栏渲染的正文是 `identify(liveContent)` 之前的 `liveContent`——宿主的
 *   `overlays.merged` 在**没有加粗时就是 `detail.content` 本身**，也就是后端读旧记录那份
 *   **没有 id** 的正文。渲染正文里没有那个 id，后端取不到条目级覆盖 → 继承分区默认 →
 *   "每行一个字段"。
 *
 * 本文件把"面板写下的 id 必须出现在送去渲染的正文里"变成断言；同时钉住
 * `ensureEntryIds` 的稳定性（同一份正文换个引用/再调一次，id 必须还是那一批），
 * 否则保存一次、宿主换一份 detail 就又把配置打断。
 *
 * 断言一律走 `t()` / role / aria-label（禁中文 ByText）；条目名是业务数据，用 ASCII。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ResumeContent, ResumeLayout } from "../../types";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import { DEFAULT_LAYOUT } from "../ResumeLayoutControls.testkit";
import { ensureEntryIds, resetEntryIdCache } from "../../features/resume-document/identity";
import ResumeZoomModal from "./ResumeZoomModal";

vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));

/** 画布桩：只把"当前显示的是哪一份 html"暴露出来，可达性与 iframe 无关。 */
vi.mock("../ResumePreview", () => ({
  default: ({ html }: { html: string }) => <div data-testid="canvas-html">{html}</div>,
}));

/** 每一次 `/resumes/render` 的入参（宿主重排与实时预览共用同一个 api）。 */
const renderCalls: { content: ResumeContent; layout: ResumeLayout }[] = [];

vi.mock("../../api/resumeLayout", () => ({
  renderResume: (content: ResumeContent, layout: ResumeLayout): Promise<string> => {
    renderCalls.push({ content, layout });
    return Promise.resolve(`HTML#${renderCalls.length}`);
  },
}));

const SCHOOL_A = "UniA";
const SCHOOL_B = "UniB";

/** 关键夹具：两条教育**都没有 id**（后端读旧记录就是这种形状）。 */
const CONTENT_WITHOUT_IDS = {
  photo: "",
  name: "Test User",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  personal_website: "",
  github: "",
  job_intent: "",
  summary: "",
  education: [
    { school: SCHOOL_A, major: "CS", start_date: "", end_date: "" },
    { school: SCHOOL_B, major: "EE", start_date: "", end_date: "" },
  ],
  experience: [],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
} as unknown as ResumeContent;

const BASE_LAYOUT: ResumeLayout = { ...DEFAULT_LAYOUT, format_config: {} };

/** 正文里的条目 id（缺失记 `NO_ID`，正是缺陷的形状）。 */
function idsOf(content: ResumeContent): string[] {
  return (content.education ?? []).map((item) => String((item as { id?: unknown }).id ?? "NO_ID"));
}

/** `format_config.field_layout.entries.education` 的键（面板写下的那一批）。 */
function entryKeysOf(layout: ResumeLayout): string[] {
  const config = layout.format_config as Record<string, unknown> | undefined;
  const domain = config?.["field_layout"] as Record<string, unknown> | undefined;
  const entries = domain?.["entries"] as Record<string, Record<string, unknown>> | undefined;
  return Object.keys(entries?.education ?? {});
}

/**
 * 忠实模拟宿主 `ResumeDetailModal` 的三条事实：
 * 1. `onApplyLayout` = 让宿主用**它自己那份正文**（`detail.content`，没有 id）重排 html，
 *    而宿主重排前会先 `ensureEntryIds`（见 `ResumeDetailModal` 里 `useResumeRelayout` 的注释）；
 * 2. `liveContent` = `overlays.merged`，没有加粗时与 `detail.content` **同一个引用**；
 * 3. 重排/保存成功会换一份结构相同的新 `detail`（`content` 换引用）。
 */
function Host({ recreateContentOnLayout }: { recreateContentOnLayout: boolean }) {
  const [layout, setLayout] = useState<ResumeLayout>(BASE_LAYOUT);
  const [html, setHtml] = useState("HOST#0");
  const [content, setContent] = useState<ResumeContent>(CONTENT_WITHOUT_IDS);
  return (
    <AntdApp>
      <ResumeZoomModal
        open
        html={html}
        warnings={[]}
        pages={1}
        onClose={vi.fn()}
        layout={layout}
        resumeId={7}
        content={content}
        liveContent={content}
        onApplyLayout={(next) => {
          setLayout(next);
          // 换一份**结构相同的新对象**：宿主重排/保存成功后 `detail` 就是一个新引用。
          if (recreateContentOnLayout) setContent(JSON.parse(JSON.stringify(content)));
          void (async () => {
            const api = await import("../../api/resumeLayout");
            setHtml(await api.renderResume(ensureEntryIds(content), next));
          })();
        }}
        onSaveContent={vi.fn(async () => undefined)}
      />
    </AntdApp>
  );
}

/** antd Select 的既有交互口径：mouseDown(combobox) → 点 `.ant-select-item-option`。 */
async function pickEntry(label: string): Promise<void> {
  fireEvent.mouseDown(
    await screen.findByRole("combobox", { name: t("typography.fieldLayout.entryLabel") }),
    { button: 0 },
  );
  fireEvent.click(
    await screen.findByText(
      (content, element) => content === label && !!element?.closest(".ant-select-item-option"),
    ),
  );
}

async function pickColumns(columns: 1 | 2 | 3): Promise<void> {
  fireEvent.click(
    await screen.findByRole("radio", {
      name: t(`typography.fieldLayout.columns.${columns}` as never),
    }),
  );
}

beforeEach(() => {
  renderCalls.length = 0;
  // 用例之间不能共享 id 缓存（否则第二条用例拿到上一条的 id，缺陷与修复都测不出来）。
  resetEntryIdCache();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("条目级字段排版 · 面板写下的 id 必须出现在渲染正文里", () => {
  it("正文没有条目 id 时，选中一条设 3 列 → 送去渲染的正文带着同一个 id", async () => {
    render(<Host recreateContentOnLayout={false} />);
    await pickEntry(SCHOOL_B);
    await pickColumns(3);
    // 等实时预览那一发（600ms 防抖 + 一拍）。
    await waitFor(() => expect(renderCalls.length).toBeGreaterThan(1), { timeout: 4000 });

    // 每一次渲染（宿主重排 + 实时预览）都必须带着面板写下的那个 id。
    for (const call of renderCalls) {
      const keys = entryKeysOf(call.layout);
      expect(keys).toHaveLength(1);
      expect(idsOf(call.content)).toContain(keys[0]);
      // 另一条条目仍然是"未设置"（不会被同一条覆盖顺手带上）。
      expect(idsOf(call.content).filter((id) => id === keys[0])).toHaveLength(1);
    }
    // 画布显示的是最后那一份渲染结果（不是宿主那份没 id 的 html）。
    expect(screen.getByTestId("canvas-html").textContent).toBe(`HTML#${renderCalls.length}`);
  }, 20000);

  it("宿主换了一份结构相同的新正文（保存后刷新）→ 条目 id 不变，配置继续生效", async () => {
    const first = ensureEntryIds(CONTENT_WITHOUT_IDS);
    // 同一份内容的新引用（`JSON.parse` 往返 = 保存后宿主拿到的形状）。
    const second = ensureEntryIds(JSON.parse(JSON.stringify(CONTENT_WITHOUT_IDS)));
    expect(idsOf(second)).toEqual(idsOf(first));
    // 已经带 id 的正文再补一次：一个字节都不动（W01 第 3 条规则）。
    expect(idsOf(ensureEntryIds(second))).toEqual(idsOf(second));
  });

  it("连续两次改列数（宿主每次都换正文引用）→ 只有最新那次生效的那条 id 落在配置里", async () => {
    render(<Host recreateContentOnLayout />);
    await pickEntry(SCHOOL_B);
    await pickColumns(2);
    await waitFor(() => expect(renderCalls.length).toBeGreaterThan(0), { timeout: 4000 });
    const firstKeys = entryKeysOf(renderCalls[renderCalls.length - 1].layout);
    await pickColumns(3);
    await waitFor(() => expect(renderCalls.length).toBeGreaterThan(1), { timeout: 4000 });

    const lastCall = renderCalls[renderCalls.length - 1];
    // id 没有被"换一份正文"重新生成：第二次提交仍然指向同一个条目 id。
    expect(entryKeysOf(lastCall.layout)).toEqual(firstKeys);
    expect(idsOf(lastCall.content)).toContain(firstKeys[0]);
  }, 20000);
});
