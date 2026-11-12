// SPDX-License-Identifier: Apache-2.0
/**
 * 「结构」页签里的未收录资料组（#24 24D）。
 *
 * 钉三件事：
 * 1. 清单**自取**（`getResume`）：制作台外壳没有 detail，这一组不许要求宿主再传一份；
 * 2. 「补进简历」发的是 `{section_key, entry_ids, base_revision}`，且 `base_revision` 用的是
 *    **读清单时那一版**（条件写，别处保存过就 409）；
 * 3. 补入成功后**重读**清单：条数由后端修剪后自然减 1（前端不自己删，口径只有后端一份）。
 *
 * 本文件不含 CJK 字面量（棘轮对新增中文断言会红）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ResumeCoverageNote, ResumeDetail } from "../../../types";
import CoverageStructureGroup from "./CoverageStructureGroup";

const mocks = vi.hoisted(() => ({
  getResume: vi.fn(),
  append: vi.fn(),
}));

vi.mock("../../../api/resumes", () => ({
  getResume: mocks.getResume,
  appendProfileEntries: mocks.append,
}));

const NOTE: ResumeCoverageNote = {
  section: "custom:portfolio",
  section_label: "PORTFOLIO",
  names: ["Alpha", "Beta"],
  filtered: [],
  model_omitted: [],
  total: 2,
  entry_ids: ["e1", "e2"],
};

function detail(notes: ResumeCoverageNote[], revision: number): ResumeDetail {
  return { id: 7, revision, coverage_notes: notes } as unknown as ResumeDetail;
}

const COUNT = (count: number) => t("resume.coverage.summary", { count });
const APPEND = t("resume.coverage.append");

function renderGroup(props: Partial<React.ComponentProps<typeof CoverageStructureGroup>> = {}) {
  const onNotify = vi.fn();
  const view = render(
    <AntdApp>
      <CoverageStructureGroup resumeId={7} onNotify={onNotify} {...props} />
    </AntdApp>,
  );
  return { ...view, onNotify };
}

beforeEach(() => {
  mocks.getResume.mockReset();
  mocks.append.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("CoverageStructureGroup", () => {
  it("reads the omitted list from the record and shows the count", async () => {
    mocks.getResume.mockResolvedValue(detail([NOTE], 3));
    renderGroup();
    expect(await screen.findByText(COUNT(2))).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: t("resume.diagnostics.entry.coverage") }),
    ).toBeInTheDocument();
    expect(mocks.getResume).toHaveBeenCalledWith(7);
  });

  it("renders nothing for a host without a record id", () => {
    const { container } = renderGroup({ resumeId: null });
    expect(container.querySelector(".resume-wb-coverage")).toBeNull();
    expect(mocks.getResume).not.toHaveBeenCalled();
  });

  it("renders nothing when the record has no omitted items", async () => {
    mocks.getResume.mockResolvedValue(detail([], 3));
    const { container } = renderGroup();
    await waitFor(() => expect(mocks.getResume).toHaveBeenCalledTimes(1));
    expect(container.querySelector(".resume-wb-coverage")).toBeNull();
  });

  it("appends through the conditional write and re-reads the trimmed list", async () => {
    mocks.getResume.mockResolvedValueOnce(detail([NOTE], 3));
    mocks.append.mockResolvedValue({
      resume: detail([], 4),
      appended: ["Alpha", "Beta"],
      skipped: [],
    });
    // 补入后后端修剪清单：重读只回一条（条数减 1）。
    mocks.getResume.mockResolvedValueOnce(
      detail([{ ...NOTE, names: ["Beta"], total: 1, entry_ids: ["e2"] }], 4),
    );
    const { onNotify } = renderGroup();
    await screen.findByText(COUNT(2));

    fireEvent.click(screen.getByRole("button", { name: APPEND }));

    await waitFor(() => expect(mocks.append).toHaveBeenCalledTimes(1));
    expect(mocks.append.mock.calls[0][0]).toBe(7);
    expect(mocks.append.mock.calls[0][1]).toMatchObject({
      sectionKey: "custom:portfolio",
      entryIds: ["e1", "e2"],
      // 读清单时那一版（不是宿主 props 里的旧值）
      baseRevision: 3,
    });
    expect(await screen.findByText(COUNT(1))).toBeInTheDocument();
    expect(onNotify).toHaveBeenCalledWith(t("resume.coverage.appended", { count: 2 }));
  });
});
