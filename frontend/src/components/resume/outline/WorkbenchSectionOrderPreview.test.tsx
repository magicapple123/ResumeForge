// SPDX-License-Identifier: Apache-2.0
/**
 * #9 回归：制作台「板块 → 调整板块顺序」必须走到**右栏草稿预览**，并且保存链路拿到的是同一份
 * `format_config.section_order`。
 *
 * 用户反馈 #9：调整板块顺序后预览简历没有变化。这条链路跨四层，各自的单测都绿：
 *
 *   1. ResumeTemplateControls 的上移/下移 → onChange(nextLayout)（format_config.section_order）；
 *   2. 制作台把版式交给宿主（onApplyLayout）→ 宿主重排并把新版式回灌 layout；
 *   3. 右栏草稿预览：ResumeWorkbenchLiveCanvas → useResumeLivePreview → renderResume；
 *   4. 保存：整体保存的版式一步（onCommitLayout / documentPipeline.saveLayout）。
 *
 * 这里从**真实工作台组件**点按钮，只把「服务端重排」与画布本体换成替身，断言 3、4 两层拿到的
 * 都是新顺序。宽档/窄档都跑：这两档的版式链路是同一份，但窄档的中栏在抽屉里，容易再分叉。
 */
import { App as AntdApp } from "antd";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ResumeContent, ResumeLayout } from "../../../types";
import { TEMPLATE_CATALOG } from "../../../test/resumeFixtures";
import { DEFAULT_LAYOUT } from "../../ResumeLayoutControls.testkit";
import ResumeZoomModal from "../ResumeZoomModal";

const renderResume = vi.hoisted(() =>
  vi.fn<(content: ResumeContent, layout: ResumeLayout, signal?: AbortSignal) => Promise<string>>(),
);
vi.mock("../../../api/resumeLayout", () => ({ renderResume }));
vi.mock("../../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
// 画布本体（真 iframe + 量高）与本用例无关；把「此刻画的是哪一版 HTML」挂到 data 属性上。
vi.mock("../ResumeWorkbenchCanvas", () => ({
  default: ({ html }: { html: string }) => <div data-testid="canvas" data-html={html} />,
}));

const CONTENT: ResumeContent = {
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
  summary: "个人总结示例。",
  education: [
    {
      school: "示例大学",
      major: "市场营销",
      degree: "本科",
      start_date: "2019-09",
      end_date: "2023-06",
      gpa: "",
      courses: [],
      achievements: [],
    },
  ],
  experience: [
    {
      company: "示例科技",
      role: "运营",
      start_date: "2023-07",
      end_date: "至今",
      description: ["一条"],
    },
  ],
  campus_experience: [],
  projects: [
    {
      name: "示例项目",
      role: "成员",
      start_date: "2024-01",
      end_date: "2024-06",
      description: ["一条"],
      highlights: [],
      tech_stack: [],
    },
  ],
  skills: [{ name: "技能一", level: "" }],
  awards: [],
};

const OPENING_LAYOUT: ResumeLayout = { ...DEFAULT_LAYOUT, format_config: {} };

/** 宿主替身：onApplyLayout 回灌 layout（与 ResumeDetailModal 的 onRendered 同形）。 */
function Harness(props: { onCommitLayout?: () => Promise<boolean> }) {
  const [layout, setLayout] = useState<ResumeLayout>(OPENING_LAYOUT);
  return (
    <AntdApp>
      <ResumeZoomModal
        open
        html="<html></html>"
        warnings={[]}
        pages={1}
        onClose={vi.fn()}
        layout={layout}
        resumeId={42}
        content={CONTENT}
        onApplyLayout={(next) => setLayout(next)}
        onCommitLayout={props.onCommitLayout ?? (async () => true)}
        onSaveContent={vi.fn(async () => undefined)}
      />
    </AntdApp>
  );
}

function stubViewport(width: number): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => {
      const limit = Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
      return {
        matches: limit > 0 && width <= limit,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      };
    },
  });
}

/** 打开「板块 → 顺序」浮层，把第 2 项上移（第 1 项的上移按钮是禁用的）。 */
async function moveSecondSectionUp(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "调整简历板块顺序" }));
  const list = await waitFor(() => {
    const node = document.querySelector<HTMLElement>(".resume-section-order-list");
    expect(node).not.toBeNull();
    return node as HTMLElement;
  });
  const rows = within(list).getAllByRole("listitem");
  fireEvent.click(within(rows[1]).getByRole("button", { name: /^把.+上移$/ }));
}

function lastRenderOrder(): string[] | undefined {
  const calls = renderResume.mock.calls;
  if (calls.length === 0) return undefined;
  return (calls[calls.length - 1][1].format_config as { section_order?: string[] } | undefined)
    ?.section_order;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("制作台 · 板块顺序 → 右栏草稿预览", () => {
  for (const [label, width] of [
    ["宽档", 1680],
    ["窄档", 1180],
  ] as const) {
    it(`${label}：上移一个板块后，/resumes/render 用新顺序重排，画布换成新 HTML`, async () => {
      stubViewport(width);
      // 服务端重排的替身：把"第一块是谁"写进 HTML，画布上的断言才看得出换没换。
      renderResume.mockImplementation(async (_content, layout) => {
        const first = (layout.format_config as { section_order?: string[] } | undefined)
          ?.section_order?.[0];
        return `<html data-first="${first ?? ""}"></html>`;
      });
      render(<Harness />);

      await moveSecondSectionUp();
      // 模板目录的默认顺序：教育经历 → 实习/工作经历 → …，把第 2 项上移后第一块变成 experience。
      await waitFor(() => expect(lastRenderOrder()?.[0]).toBe("experience"), { timeout: 4000 });
      await waitFor(() =>
        expect(screen.getByTestId("canvas").getAttribute("data-html")).toContain(
          'data-first="experience"',
        ),
      );
      // 改过的版式进入脏值：动作条出现保存入口。
      expect(
        screen.getByRole("button", { name: new RegExp(t("workbench.action.save-changes")) }),
      ).toBeInTheDocument();
    }, 20000);
  }

  it("保存：版式落库通道被调用，且此时 layout.format_config.section_order 已是新顺序", async () => {
    stubViewport(1680);
    renderResume.mockResolvedValue("<html></html>");
    const onCommitLayout = vi.fn(async () => true);
    render(<Harness onCommitLayout={onCommitLayout} />);
    await moveSecondSectionUp();
    await waitFor(() => expect(lastRenderOrder()?.[0]).toBe("experience"), { timeout: 4000 });

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("workbench.action.save-changes")) }),
    );
    await waitFor(() => expect(onCommitLayout).toHaveBeenCalledTimes(1));
  }, 20000);
});
