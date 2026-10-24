// SPDX-License-Identifier: Apache-2.0
/**
 * 「对象批注」面板测试（W18 / 契约 wave3 §4）。
 *
 * 覆盖：加载/空态/错误态、状态筛选、resolve/reopen/dismiss、stale 的显式"重新关联"、
 * 回传导入（前端解析拦截 + 成功后刷新列表）、只读宿主、定位回调。
 *
 * 中文只出现在夹具常量里；断言一律走 `t()` / role / 常量，避免 `cjkRatchet` tests 口径。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { ensureIds } from "../../../features/resume-document/identity";
import { entriesOf, entryIdOf } from "../../../features/resume-outline/model";
import {
  buildReviewPack,
  createMockReviewAnnotationApi,
  serializeReviewPack,
  type ReviewAnnotationRecord,
} from "../../../features/resume-review";
import type { ResumeContent } from "../../../types/resume";
import ReviewAnnotationsPanel from "./ReviewAnnotationsPanel";

const PROJECT_A = "项目甲";
const PROJECT_B = "项目乙";
const REVIEWER = "李老师";
const ANNOTATION_TEXT = "这段经历的量化结果需要补";
const SNAPSHOT = "a".repeat(64);
const TOKEN = "0123456789abcdef0123456789abcdef";

function content(): ResumeContent {
  return ensureIds({
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
    education: [],
    experience: [],
    campus_experience: [],
    projects: [
      {
        name: PROJECT_A,
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: ["甲一"],
        highlights: [],
      },
      {
        name: PROJECT_B,
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: ["乙一"],
        highlights: [],
      },
    ],
    skills: [],
    awards: [],
  });
}

const CONTENT = content();
const PROJECT_B_ID = entryIdOf(entriesOf(CONTENT, "projects")[1]);

function record(overrides: Partial<ReviewAnnotationRecord> = {}): ReviewAnnotationRecord {
  return {
    id: 1,
    share_package_id: 7,
    resume_id: 3,
    document_version_id: null,
    snapshot_sha256: SNAPSHOT,
    external_id: "ext-001",
    object_id: PROJECT_B_ID,
    point_id: null,
    path: null,
    field: null,
    quoted_text: "",
    text: ANNOTATION_TEXT,
    reviewer: REVIEWER,
    status: "open",
    resolved_at: null,
    created_at: "2026-10-24T10:00:00Z",
    ...overrides,
  };
}

function renderPanel(
  options: {
    api?: ReturnType<typeof createMockReviewAnnotationApi>;
    readOnly?: boolean;
    onLocate?: (path: string) => void;
    showTitle?: boolean;
  } = {},
) {
  const api =
    options.api ?? createMockReviewAnnotationApi({ initial: [record()], content: CONTENT });
  const utils = render(
    <AntdApp>
      <ReviewAnnotationsPanel
        sharePackageId={7}
        api={api}
        content={CONTENT}
        readOnly={options.readOnly}
        onLocate={options.onLocate}
        showTitle={options.showTitle}
      />
    </AntdApp>,
  );
  return { ...utils, api };
}

function annotationItems(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".resume-review-row"));
}

/**
 * 按文案找按钮：antd 会给两字中文按钮自动插空格（"重 试"），带图标的按钮可访问名里
 * 还有图标名（"import 导入回传批注"）。统一归一化后做子串匹配，避免为每个按钮写正则。
 */
function button(label: string): HTMLElement {
  const target = label.replace(/\s/g, "");
  return screen.getByRole("button", {
    name: (accessibleName: string) => accessibleName.replace(/\s/g, "").includes(target),
  });
}

function queryButton(label: string): HTMLElement | null {
  const target = label.replace(/\s/g, "");
  return screen.queryByRole("button", {
    name: (accessibleName: string) => accessibleName.replace(/\s/g, "").includes(target),
  });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("加载与空态", () => {
  it("加载后展示计数、状态与正文（没有英文原因码/键名）", async () => {
    const { api } = renderPanel();
    expect(await screen.findByText(ANNOTATION_TEXT)).toBeInTheDocument();
    expect(api.calls).toContain("list");
    expect(screen.getByText(t("review.panel.summary", { total: 1, open: 1 }))).toBeInTheDocument();
    expect(within(annotationItems()[0]).getByText(t("review.status.open"))).toBeInTheDocument();
    expect(
      within(annotationItems()[0]).getByText(t("review.annotation.reviewer", { name: REVIEWER })),
    ).toBeInTheDocument();
  });

  it("空列表显示空态与下一步说明", async () => {
    renderPanel({ api: createMockReviewAnnotationApi({ initial: [], content: CONTENT }) });
    expect(await screen.findByText(t("review.panel.empty"))).toBeInTheDocument();
    expect(screen.getByText(t("review.panel.emptyHint"))).toBeInTheDocument();
  });

  it("加载失败 → 错误态 + 重试成功后出列表", async () => {
    const base = createMockReviewAnnotationApi({ initial: [record()], content: CONTENT });
    let attempts = 0;
    const api = {
      ...base,
      list: vi.fn(async (sharePackageId: number) => {
        attempts += 1;
        if (attempts === 1) throw new Error("boom");
        return base.list(sharePackageId);
      }),
    };
    renderPanel({ api: { ...api, calls: base.calls } as typeof base });
    expect(await screen.findByText(t("review.panel.loadFailed"))).toBeInTheDocument();
    fireEvent.click(button(t("common.retry")));
    expect(await screen.findByText(ANNOTATION_TEXT)).toBeInTheDocument();
  });
});

describe("状态筛选与状态操作", () => {
  it("筛选「已解决」只剩 resolved 条目", async () => {
    const api = createMockReviewAnnotationApi({
      content: CONTENT,
      initial: [
        record({ id: 1, external_id: "ext-1", status: "open" }),
        record({
          id: 2,
          external_id: "ext-2",
          status: "resolved",
          text: `${ANNOTATION_TEXT}（第二版）`,
        }),
      ],
    });
    renderPanel({ api });
    expect(await screen.findByText(ANNOTATION_TEXT)).toBeInTheDocument();
    expect(annotationItems()).toHaveLength(2);
    // 状态标签与筛选按钮同文案：筛选在工具栏（DOM 顺序在前），取第一个。
    fireEvent.click(screen.getAllByText(t("review.filter.resolved"))[0]);
    await waitFor(() => expect(annotationItems()).toHaveLength(1));
    expect(within(annotationItems()[0]).getByText(t("review.status.resolved"))).toBeInTheDocument();
  });

  it("标记已解决 → 调接口并把该行状态换成 resolved（不重载整个列表）", async () => {
    const { api } = renderPanel();
    await screen.findByText(ANNOTATION_TEXT);
    fireEvent.click(button(t("review.action.resolve")));
    await waitFor(() => expect(api.calls).toContain("resolve:1"));
    await waitFor(() =>
      expect(
        within(annotationItems()[0]).getByText(t("review.status.resolved")),
      ).toBeInTheDocument(),
    );
  });

  it("已解决可以重新打开；忽略后行内不再提供状态动作", async () => {
    const api = createMockReviewAnnotationApi({
      content: CONTENT,
      initial: [record({ id: 1, external_id: "ext-1", status: "resolved" })],
    });
    renderPanel({ api });
    await screen.findByText(ANNOTATION_TEXT);
    fireEvent.click(button(t("review.action.reopen")));
    await waitFor(() => expect(api.calls).toContain("reopen:1"));
    await waitFor(() =>
      expect(within(annotationItems()[0]).getByText(t("review.status.open"))).toBeInTheDocument(),
    );
    fireEvent.click(button(t("review.action.dismiss")));
    await waitFor(() => expect(api.calls).toContain("dismiss:1"));
    await waitFor(() =>
      expect(
        within(annotationItems()[0]).getByText(t("review.status.dismissed")),
      ).toBeInTheDocument(),
    );
    expect(queryButton(t("review.action.reopen"))).toBeNull();
    expect(queryButton(t("review.action.resolve"))).toBeNull();
  });
});

describe("stale 批注：只允许显式重新关联或忽略", () => {
  it("显示失联提醒；从当前对象里选一个后调 reattach 并恢复 open", async () => {
    const api = createMockReviewAnnotationApi({
      content: CONTENT,
      initial: [
        record({ status: "stale", object_id: "ob_000000000000", external_id: "ext-stale" }),
      ],
    });
    renderPanel({ api });
    await screen.findByText(ANNOTATION_TEXT);
    expect(screen.getByText(t("review.panel.staleWarning", { count: 1 }))).toBeInTheDocument();
    expect(
      within(annotationItems()[0]).getByText(t("review.status.staleHint")),
    ).toBeInTheDocument();

    fireEvent.click(button(t("review.action.reattach")));
    const combobox = screen.getByRole("combobox", { name: t("review.reattach.title") });
    fireEvent.mouseDown(combobox);
    fireEvent.click(await screen.findByText(PROJECT_B));
    await waitFor(() => expect(api.calls).toContain("reattach:1"));
    await waitFor(() =>
      expect(within(annotationItems()[0]).getByText(t("review.status.open"))).toBeInTheDocument(),
    );
  });
});

describe("回传导入", () => {
  function validPackText(): string {
    return serializeReviewPack(
      buildReviewPack({
        shareToken: TOKEN,
        packageSnapshotSha256: SNAPSHOT,
        reviewer: REVIEWER,
        annotations: [
          {
            external_id: "ext-new",
            object_id: PROJECT_B_ID,
            text: ANNOTATION_TEXT,
          },
        ],
      }),
    );
  }

  it("前端先拦非法 JSON：指出错误且不发请求", async () => {
    const { api } = renderPanel({
      api: createMockReviewAnnotationApi({ initial: [], content: CONTENT }),
    });
    await screen.findByText(t("review.panel.empty"));
    fireEvent.click(button(t("review.action.import")));
    fireEvent.change(screen.getByRole("textbox", { name: t("review.import.pasteLabel") }), {
      target: { value: "{not json" },
    });
    fireEvent.click(button(t("review.import.submit")));
    expect(await screen.findByText(t("review.error.not-json"))).toBeInTheDocument();
    expect(api.calls).not.toContain("import");
  });

  it("合法包 → 调 import、刷新列表并给出导入/跳过计数", async () => {
    const { api } = renderPanel({
      api: createMockReviewAnnotationApi({ initial: [], content: CONTENT }),
    });
    await screen.findByText(t("review.panel.empty"));
    fireEvent.click(button(t("review.action.import")));
    fireEvent.change(screen.getByRole("textbox", { name: t("review.import.pasteLabel") }), {
      target: { value: validPackText() },
    });
    fireEvent.click(button(t("review.import.submit")));
    await waitFor(() => expect(api.calls).toContain("import"));
    expect(
      await screen.findByText(t("review.import.success", { imported: 1, duplicates: 0 })),
    ).toBeInTheDocument();
    expect(within(annotationItems()[0]).getByText(t("review.status.open"))).toBeInTheDocument();
  });
});

describe("只读与定位", () => {
  it("只读宿主：不显示导入/导出/状态动作，只保留列表与说明", async () => {
    renderPanel({ readOnly: true });
    await screen.findByText(ANNOTATION_TEXT);
    expect(screen.getByText(t("review.panel.readOnly"))).toBeInTheDocument();
    expect(queryButton(t("review.action.import"))).toBeNull();
    expect(queryButton(t("review.action.export"))).toBeNull();
    expect(queryButton(t("review.action.resolve"))).toBeNull();
  });

  it("能定位的批注显示「定位」，点击把当前 path 交给宿主", async () => {
    const onLocate = vi.fn();
    renderPanel({ onLocate });
    await screen.findByText(ANNOTATION_TEXT);
    fireEvent.click(button(t("review.action.locate")));
    expect(onLocate).toHaveBeenCalledWith("projects.1");
  });
});
