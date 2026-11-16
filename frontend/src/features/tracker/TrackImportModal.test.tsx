// SPDX-License-Identifier: Apache-2.0
/**
 * 「从通知导入进度」弹窗的**首屏形态**（I-15）。
 *
 * 这个弹窗此前一条单测都没有，于是"空态"被反复放回首屏：一打开就是一块
 * 「还没有识别结果」的大插图，而用户其实还没开始识别。这里钉三件事：
 * 初始不画空态 / 主操作与取消在同一个操作区 / 只有"识别过且 0 条"才给可行动提示。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import TrackImportModal from "./TrackImportModal";

const apiMocks = vi.hoisted(() => ({
  parseTracks: vi.fn(),
  applyTracks: vi.fn(),
}));

vi.mock("../../api/tracker", () => apiMocks);

beforeEach(() => {
  apiMocks.parseTracks.mockReset();
  apiMocks.applyTracks.mockReset();
});

afterEach(cleanup);

function renderModal() {
  return render(
    <AntdApp>
      <TrackImportModal open onClose={() => {}} onImported={() => {}} />
    </AntdApp>,
  );
}

/**
 * 弹窗底部的操作区。
 *
 * 每次断言前重新取：antd 会在状态变化时重渲 footer 内容，缓存旧节点会读到过期 DOM。
 */
function footer(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".ant-modal-footer");
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

/** 识别接口返回的一条预览；`overrides` 用来改合并结论与原因。 */
function previewItem(overrides: Record<string, unknown> = {}) {
  return {
    record: {
      company: "Example Corp",
      title: "Backend Intern",
      status: "interview",
      stage_note: "",
      applied_at: "",
      status_date: "",
      next_action: "",
      next_action_date: "",
      note: "",
      evidence: "",
    },
    action: "created",
    reason: "new record",
    current_status: "",
    ...overrides,
  };
}

/** 在正文里填一段通知内容并点识别（主操作在 footer，见 I-15）。 */
function recognizeOnce() {
  fireEvent.change(screen.getByPlaceholderText(t("trackerImport.dialog.placeholder")), {
    target: { value: "Your application is now in the interview stage." },
  });
  fireEvent.click(
    within(footer()).getByRole("button", { name: t("trackerImport.action.recognize") }),
  );
}

/**
 * antd 会给**两个汉字**的按钮自动插一个空格（`autoInsertSpace`，实际渲染成「取 消」），
 * 所以按名字定位时要容下中间那个空白，否则断言会因为排版细节而红。
 */
function spacedName(label: string): RegExp {
  return new RegExp(`^${Array.from(label).join("\\s*")}$`);
}

describe("TrackImportModal 的首屏", () => {
  it("刚打开时不渲染空态占位", () => {
    renderModal();

    // 判据必须是"识别过且 0 条"，不是"rows 为空"：一打开就画空态等于把
    // "还没开始"说成"没有结果"，而这块插图还会把 6 行输入框挤下去。
    expect(screen.queryByText(t("trackerImport.empty.noResults"))).not.toBeInTheDocument();
    expect(document.querySelector(".ant-empty")).toBeNull();
  });

  it("主操作与取消在同一个操作区，正文里不再另挂一颗主按钮", () => {
    renderModal();

    expect(
      within(footer()).getByRole("button", { name: spacedName(t("common.action.cancel")) }),
    ).toBeInTheDocument();
    expect(
      within(footer()).getByRole("button", { name: t("trackerImport.action.recognize") }),
    ).toBeInTheDocument();
    // 只有一处：此前正文一颗、footer 一颗，用户要在两个对角之间找"下一步"。
    expect(
      screen.getAllByRole("button", { name: t("trackerImport.action.recognize") }),
    ).toHaveLength(1);
  });
});

describe("TrackImportModal 的识别结果", () => {
  it("识别出 0 条时给一行可行动的提示，而不是大空态", async () => {
    apiMocks.parseTracks.mockResolvedValue({ items: [], parse_engine: "local", notes: [] });
    renderModal();

    recognizeOnce();

    expect(await screen.findByText(t("trackerImport.empty.noResults"))).toBeInTheDocument();
    expect(document.querySelector(".ant-empty")).toBeNull();
    // 一条都没有可写入的东西：主按钮留在「识别并预览」，不切换成「确认写入」。
    expect(screen.queryByRole("button", { name: /确认写入/ })).not.toBeInTheDocument();
  });

  it("有结果后主按钮换成「确认写入 N 条」，两个主操作互斥", async () => {
    apiMocks.parseTracks.mockResolvedValue({
      items: [previewItem(), previewItem({ action: "unchanged", reason: "already up to date" })],
      parse_engine: "ai",
      notes: [],
    });
    renderModal();

    recognizeOnce();

    expect(
      await screen.findByRole("button", { name: t("trackerImport.action.confirm", { count: 2 }) }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("trackerImport.action.recognize") }),
    ).not.toBeInTheDocument();
    // 有结果时当然不该再出现"没识别出"的提示。
    expect(screen.queryByText(t("trackerImport.empty.noResults"))).not.toBeInTheDocument();
  });
});
