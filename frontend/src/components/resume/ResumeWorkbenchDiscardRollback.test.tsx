// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台「放弃并关闭」必须把**主预览的版式基线**一起退回去（task-7，#9 同族）。
 *
 * 现象：在制作台里改版式（如「板块顺序」上移）后点「放弃并关闭」，弹窗关了，但简历详情页
 * 的主预览仍保持未保存的新顺序——宿主 `layout` 是**即时生效**的（每次改动都经
 * `onApplyLayout` 重排过主预览 html），丢掉时只清编辑器、不回滚版式，用户就会以为已经保存。
 *
 * 这条用例从真实工作台组件出发：点顺序按钮 → 关窗确认 → 断言宿主 layout（= 主预览的输入）
 * 回到打开制作台时那一版；对照组断言**保存后**主预览保持新顺序。宿主用最小替身
 * （与 `ResumeDetailModal` 的 `requestLayout` 同形：`onApplyLayout` 回灌 layout），
 * 只把服务端重排与画布本体换成替身。
 */
import { App as AntdApp } from "antd";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ResumeContent, ResumeLayout } from "../../types";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import { DEFAULT_LAYOUT } from "../ResumeLayoutControls.testkit";
import ResumeZoomModal from "./ResumeZoomModal";

const renderResume = vi.hoisted(() =>
  vi.fn<(content: ResumeContent, layout: ResumeLayout, signal?: AbortSignal) => Promise<string>>(
    async () => "<html></html>",
  ),
);
vi.mock("../../api/resumeLayout", () => ({ renderResume }));
vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
vi.mock("./ResumeWorkbenchCanvas", () => ({
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
  summary: "",
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
  experience: [],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
};

/** 打开制作台时的版式 = 记录里已保存的那一版（没有 section_order）。 */
const SAVED_LAYOUT: ResumeLayout = { ...DEFAULT_LAYOUT, format_config: {} };

interface HarnessProps {
  onClose?: () => void;
  onCommitLayout?: () => Promise<boolean>;
  onApplyLayout?: (next: ResumeLayout) => void;
}

function Harness({ onClose, onCommitLayout, onApplyLayout }: HarnessProps) {
  const [layout, setLayout] = useState<ResumeLayout>(SAVED_LAYOUT);
  return (
    <AntdApp>
      {/* 主预览的最小替身：它渲染的就是宿主 layout（真实链路里由 ResumerDetailModal 重排 html）。 */}
      <div
        data-testid="host-main-preview"
        data-order={((layout.format_config?.section_order as string[] | undefined) ?? []).join(",")}
      />
      <ResumeZoomModal
        open
        html="<html></html>"
        warnings={[]}
        pages={1}
        onClose={onClose ?? vi.fn()}
        layout={layout}
        resumeId={42}
        content={CONTENT}
        onApplyLayout={(next) => {
          onApplyLayout?.(next);
          setLayout(next);
        }}
        onCommitLayout={onCommitLayout ?? (async () => true)}
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

/** 打开「板块 → 顺序」并把第 2 项上移（第 1 项的上移按钮是禁用的）。 */
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

function mainPreviewOrder(): string {
  return screen.getByTestId("host-main-preview").getAttribute("data-order") ?? "";
}

function saveButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: new RegExp(t("workbench.action.save-changes")) });
}

function closeWorkbench(): void {
  fireEvent.click(screen.getByRole("button", { name: t("common.action.close") }));
}

beforeEach(() => {
  stubViewport(1680);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("制作台 · 放弃并关闭 / 保存：主预览与记录一致", () => {
  it("改板块顺序后「放弃并关闭」：宿主 layout 回到打开时那一版（主预览不再停在未保存的新序）", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    expect(mainPreviewOrder()).toBe("");

    await moveSecondSectionUp();
    await waitFor(() => expect(mainPreviewOrder().split(",")[0]).toBe("experience"));

    closeWorkbench();
    expect(await screen.findByText(t("workbench.close.title"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("workbench.close.confirm") }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // 主预览的输入（宿主 layout）退回记录那一版：与 GET /resumes 的 format_config 一致。
    await waitFor(() => expect(mainPreviewOrder()).toBe(""));
    // 版式控件也回到「顺序」初始态，不残留「顺序·已调整」。
    expect(screen.getByRole("button", { name: "调整简历板块顺序" }).textContent).not.toContain(
      "已调整",
    );
  }, 20000);

  it("改板块顺序后「保存修改」：主预览保持新顺序，关闭时不再确认（没有未保存改动）", async () => {
    const onClose = vi.fn();
    const onCommitLayout = vi.fn(async () => true);
    render(<Harness onClose={onClose} onCommitLayout={onCommitLayout} />);

    await moveSecondSectionUp();
    await waitFor(() => expect(mainPreviewOrder().split(",")[0]).toBe("experience"));

    fireEvent.click(saveButton() as HTMLElement);
    await waitFor(() => expect(onCommitLayout).toHaveBeenCalledTimes(1));
    // 保存后脏值归零：保存入口收起。
    await waitFor(() => expect(saveButton()).toBeNull());
    // 主预览保持"新顺序"（保存出去的正是它）。
    expect(mainPreviewOrder().split(",")[0]).toBe("experience");

    closeWorkbench();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(t("workbench.close.title"))).toBeNull();
    expect(mainPreviewOrder().split(",")[0]).toBe("experience");
  }, 20000);
});
