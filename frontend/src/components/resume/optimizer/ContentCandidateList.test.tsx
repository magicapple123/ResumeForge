// SPDX-License-Identifier: Apache-2.0
/**
 * 内容精简候选列表（W09）：卡片要如实列出改动、可测量时给真实溢出、不可测时说明"应用后重新诊断"；
 * 应用只调宿主回调（内容写回 + 历史由宿主负责），组件自己不写文档。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ot } from "../../../features/resume-optimizer/i18n";
import type { OptimizerContentCandidate } from "../../../features/resume-optimizer/types";
import type { ResumeContent } from "../../../types/resume";
import ContentCandidateList from "./ContentCandidateList";

const CONTENT = { name: "示例甲" } as unknown as ResumeContent;

function candidate(overrides: Partial<OptimizerContentCandidate> = {}): OptimizerContentCandidate {
  return {
    key: "content:duplicate-entries",
    kind: "duplicate-entries",
    content: CONTENT,
    stats: {
      entriesRemoved: 2,
      pointsRemoved: 0,
      pointsMerged: 0,
      charsSaved: 120,
      visibleRemoved: 2,
    },
    items: [
      { field: "experience", objectId: "exp_aaaa0002", label: "甲公司" },
      { field: "experience", objectId: "exp_aaaa0003", label: "甲公司" },
    ],
    itemCount: 2,
    measureCss: '[data-object-id="exp_aaaa0002"]{display:none !important;}',
    ...overrides,
  };
}

const BEFORE = { usedHeight: 1200, pageContentHeight: 1000, pageLimit: 1 };
const AFTER = { usedHeight: 980, pageContentHeight: 1000, pageLimit: 1 };

function renderList(props: Parameters<typeof ContentCandidateList>[0]) {
  return render(
    <AntdApp>
      <ContentCandidateList {...props} />
    </AntdApp>,
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ContentCandidateList", () => {
  it("列出改动对象与统计，并用 probe 给出真实溢出减少", () => {
    const probe = vi.fn(() => AFTER);
    renderList({ candidates: [candidate()], probe, before: BEFORE, targetPages: 1 });
    expect(screen.getByText(ot("optimizer.content.kind.duplicate-entries"))).toBeInTheDocument();
    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain(ot("optimizer.content.stats.entries", { count: 2 }));
    expect(bodyText).toContain([candidate().items[0].label, candidate().items[1].label].join("、"));
    expect(probe).toHaveBeenCalledWith(candidate().measureCss);
    expect(bodyText).toContain(ot("optimizer.content.measure.reduced", { value: 200 }));
  });

  it("合并类候选没有 measureCss：如实说应用后重新诊断，不声称溢出结果", () => {
    renderList({
      candidates: [
        candidate({ kind: "merge-short-points", measureCss: null, key: "content:merge" }),
      ],
      probe: vi.fn(() => AFTER),
      before: BEFORE,
      targetPages: 1,
    });
    expect(screen.getByText(ot("optimizer.content.measure.after"))).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(
      ot("optimizer.content.measure.reduced", { value: 0 }).slice(0, 2),
    );
  });

  it("应用只调宿主 onApply（内容由宿主写回），成功后按钮标记已精简", async () => {
    const onApply = vi.fn();
    renderList({ candidates: [candidate()], targetPages: 1, onApply });
    fireEvent.click(
      screen.getByRole("button", { name: ot("optimizer.content.apply.aria", { index: 1 }) }),
    );
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(candidate()));
    expect(await screen.findByText(ot("optimizer.content.applied"))).toBeInTheDocument();
  });

  it("宿主写回失败：不标记已应用、渲染行内错误（不产生未处理 rejection）", async () => {
    const onApply = vi.fn().mockRejectedValue(new Error("save failed"));
    renderList({ candidates: [candidate()], targetPages: 1, onApply });
    fireEvent.click(
      screen.getByRole("button", { name: ot("optimizer.content.apply.aria", { index: 1 }) }),
    );
    expect(await screen.findByText(ot("optimizer.content.applyFailed"))).toBeInTheDocument();
    expect(screen.getByText("save failed")).toBeInTheDocument();
    expect(screen.queryByText(ot("optimizer.content.applied"))).toBeNull();
  });

  it("无候选时不渲染任何内容（不占位）", () => {
    const { container } = renderList({ candidates: [], targetPages: 1 });
    expect(container.textContent).toBe("");
  });
});
