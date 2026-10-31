// SPDX-License-Identifier: Apache-2.0
/**
 * 用户手写简历弹窗（F4，v2 文档模型）：初始内容**整份来自当前组投影**，岗位模式只覆盖
 * 求职意向；保存/建草稿提交的都是 v2 `ResumeDocument`。
 *
 * 2026-10-30 切 v2 后本弹窗不再有 v1 表单、草稿条、逐条填入（那些机制随 v1 编辑器链删除）。
 * 因此这里钉的是"弹窗与投影/保存契约"，不再断言表单字段顺序或填入按钮：
 * 1. 通用模式：打开即用投影文档（header/sections 来自 v2 content）；
 * 2. 岗位模式：只把 header 的 subtitle item 覆盖成岗位名，正文不改；
 * 3. 资料来源面板来自 `source_layout`（7/13 分区的行数由服务端决定，前端不硬编码）；
 * 4. 保存/「前往制作台」提交 v2 content 并携带语言与快照上下文；
 * 5. 关闭：无未保存修改时直接关，不额外确认。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import type { Job } from "../types";
import type { PaperProjectionOut } from "../features/profile-library/types";
import type { ResumeDocument } from "../types/resumeDocument";
import { projectionToResumeDocument } from "../utils/profileToResume";
import { projectionOf, projectionWithThirteenSections } from "../test/profileProjectionFixture";
import ManualResumeModal from "./ManualResumeModal";

const apiMocks = vi.hoisted(() => ({
  createManualResume: vi.fn(),
  fetchResumeTemplates: vi.fn(),
  projection: null as unknown,
  navigate: vi.fn(),
}));

vi.mock("../api/resumes", () => ({
  createManualResume: apiMocks.createManualResume,
  fetchResumeTemplates: apiMocks.fetchResumeTemplates,
}));
vi.mock("../features/profile-library/useCurrentProjection", () => ({
  useCurrentProjection: () => ({
    data: apiMocks.projection,
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => apiMocks.navigate }));

const JOB = {
  id: 9,
  title: "Frontend Engineer",
  company: "Example Corp",
  location: "Shanghai",
  salary: "",
  job_type: "full_time",
  description: "Build the frontend of the resume product.",
  requirements: "React and TypeScript.",
  keywords: ["React", "TypeScript"],
} as unknown as Job;

function projection7() {
  return projectionOf({
    content: {
      name: "张三",
      phone: "13800000000",
      job_intent: "旧求职意向",
      summary: "个人总结",
      education: [
        {
          school: "示例大学",
          major: "软件工程",
          degree: "本科",
          start_date: "2023.09",
          end_date: "2027.06",
          gpa: "",
          courses: [],
          achievements: [],
        },
      ],
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.projection = projection7();
  apiMocks.createManualResume.mockResolvedValue({ id: 77, title: "新简历" });
  apiMocks.fetchResumeTemplates.mockResolvedValue({
    profile_section_order: ["education", "summary"],
  });
});

afterEach(() => cleanup());

function renderModal(
  options: {
    job?: Job | null;
    open?: boolean;
    onClose?: () => void;
    onOpenWorkbench?: (id: number) => void;
  } = {},
) {
  const onClose = options.onClose ?? vi.fn();
  const onOpenWorkbench = options.onOpenWorkbench ?? vi.fn();
  const result = render(
    <AntdApp>
      <ManualResumeModal
        job={options.job ?? null}
        open={options.open ?? true}
        onClose={onClose}
        onOpenWorkbench={onOpenWorkbench}
      />
    </AntdApp>,
  );
  return { onClose, onOpenWorkbench, rerender: result.rerender };
}

function savedContent(): ResumeDocument {
  const payload = apiMocks.createManualResume.mock.calls[0][0] as { content: ResumeDocument };
  return payload.content;
}

function subtitleOf(document: ResumeDocument): string {
  return document.header.items.find((item) => item.placement === "subtitle")?.value ?? "";
}

describe("ManualResumeModal（v2）", () => {
  it("通用模式：打开即用投影文档，保存提交 v2 content", async () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: t("resume.manual.save") }));
    await waitFor(() => expect(apiMocks.createManualResume).toHaveBeenCalledTimes(1));

    const payload = apiMocks.createManualResume.mock.calls[0][0] as {
      job_id: number | null;
      content: ResumeDocument;
    };
    expect(payload.job_id).toBeNull();
    const document = savedContent();
    expect(document.version).toBe(2);
    expect(document.sections.map((section) => section.key)).toEqual(["education", "summary"]);
    expect(subtitleOf(document)).toBe("旧求职意向");
    expect(
      document.header.items.some((item) => item.placement === "name" && item.value === "张三"),
    ).toBe(true);
  });

  it("岗位模式：只把求职意向覆盖成岗位名，正文与通用模式逐字相同", async () => {
    apiMocks.projection = projection7();
    renderModal({ job: JOB });
    fireEvent.click(screen.getByRole("button", { name: t("resume.manual.save") }));
    await waitFor(() => expect(apiMocks.createManualResume).toHaveBeenCalledTimes(1));

    const payload = apiMocks.createManualResume.mock.calls[0][0] as {
      job_id: number | null;
      content: ResumeDocument;
    };
    expect(payload.job_id).toBe(JOB.id);
    expect(subtitleOf(savedContent())).toBe(JOB.title);
    const generic = projectionToResumeDocument(apiMocks.projection as PaperProjectionOut, null);
    expect(savedContent().sections).toEqual(generic.sections);
  });

  it("资料来源面板的行数来自 source_layout（13 分区不硬编码）", async () => {
    apiMocks.projection = projectionWithThirteenSections();
    renderModal();
    const title = await screen.findByText(t("editor.sources.title"));
    const block = title.closest("div") as HTMLElement;
    expect(within(block).getAllByRole("listitem")).toHaveLength(13);
  });

  it("「去切换组」只关闭弹窗并跳资料页（不换组、不发请求）", async () => {
    const { onClose } = renderModal();
    fireEvent.click(
      await screen.findByRole("button", { name: t("profileLibrary.empty.switchGroup") }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(apiMocks.navigate).toHaveBeenCalledWith("/profile");
  });

  it("「前往制作台」用同一份 v2 文档建草稿，并把新简历 id 交给宿主", async () => {
    const { onOpenWorkbench } = renderModal();
    fireEvent.click(
      await screen.findByRole("button", { name: t("workbench.action.open-from-new") }),
    );
    await waitFor(() => expect(apiMocks.createManualResume).toHaveBeenCalledTimes(1));
    const payload = apiMocks.createManualResume.mock.calls[0][0] as {
      draft?: boolean;
      content: ResumeDocument;
    };
    expect(payload.draft).toBe(true);
    expect(payload.content.version).toBe(2);
    await waitFor(() => expect(onOpenWorkbench).toHaveBeenCalledWith(77));
  });

  it("没有未保存修改时，关闭直接走 onClose（不再弹确认）", async () => {
    const { onClose } = renderModal();
    // antd 会在两个汉字之间插入空格（autoInsertSpace），按去空白后的文本匹配。
    const compact = (text: string | null) => (text ?? "").replace(/\s+/g, "");
    const close = await waitFor(() => {
      const button = screen
        .getAllByRole("button")
        .find((candidate) => compact(candidate.textContent) === compact(t("resume.manual.close")));
      if (!button) throw new Error("close button not found");
      return button;
    });
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(t("resume.manual.unsaved"))).toBeNull();
  });

  it("关闭后再次打开仍渲染编辑器（open false → true）", async () => {
    const onClose = vi.fn();
    const renderWithOpen = (open: boolean) => (
      <AntdApp>
        <ManualResumeModal job={null} open={open} onClose={onClose} />
      </AntdApp>
    );
    const { rerender } = render(renderWithOpen(true));
    expect(
      await screen.findByRole("button", { name: t("resume.manual.save") }),
    ).toBeInTheDocument();
    rerender(renderWithOpen(false));
    rerender(renderWithOpen(true));
    expect(
      await screen.findByRole("button", { name: t("resume.manual.save") }),
    ).toBeInTheDocument();
  });

  it("新建界面里的字段可以点击并打开编辑器", async () => {
    renderModal();
    fireEvent.click(await screen.findByRole("tab", { name: t("editor.section.education") }));
    const chip = await screen.findByRole("group", { name: /示例大学/ });
    fireEvent.click(within(chip).getAllByRole("button")[0]);
    expect(await screen.findByLabelText(t("document.field.value"))).toBeInTheDocument();
  });

  it("清空所有内容：保留板块与页眉字段，条目和值清空", async () => {
    renderModal();
    expect(
      await screen.findByRole("button", { name: t("resume.manual.clearAll") }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("resume.manual.clearAll") }));
    const confirmButtons = await screen.findAllByRole("button", {
      name: t("resume.manual.clearAll"),
    });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    fireEvent.click(screen.getByRole("button", { name: t("resume.manual.save") }));
    await waitFor(() => expect(apiMocks.createManualResume).toHaveBeenCalledTimes(1));
    const content = savedContent();
    expect(content.sections.map((section) => section.key)).toEqual(["education", "summary"]);
    expect(content.sections.every((section) => section.entries.length === 0)).toBe(true);
    expect(content.header.items.every((item) => item.value === "")).toBe(true);
  });

  it("默认板块顺序跟随「我的资料」", async () => {
    apiMocks.fetchResumeTemplates.mockResolvedValue({
      profile_section_order: ["summary", "education"],
    });
    renderModal();
    await waitFor(() => {
      const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent?.replace(/\s+/g, ""));
      expect(tabs.indexOf(t("editor.field.summary").replace(/\s+/g, ""))).toBeLessThan(
        tabs.indexOf(t("editor.section.education").replace(/\s+/g, "")),
      );
    });
  });
});
