// SPDX-License-Identifier: Apache-2.0
/** 一键脱敏：预览遮罩后的字段 + 下载脱敏版（独立文件、不回写）。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeResumeDocument } from "../test/documentHarness";
import type { ResumeDocument } from "../types";
import RedactionModal from "./RedactionModal";

const apiMocks = vi.hoisted(() => ({
  redactResume: vi.fn(),
  exportResumeWithOptions: vi.fn(),
}));

const downloadMocks = vi.hoisted(() => ({
  downloadBlob: vi.fn(),
}));

vi.mock("../api/resumes", () => apiMocks);
vi.mock("../utils/download", () => downloadMocks);

/** 脱敏后的 v2 文档：姓名/手机/邮箱/最近公司被遮成 ***，其余字段保持可读。 */
function redactedDocument(): ResumeDocument {
  const document = makeResumeDocument();
  for (const key of ["name", "phone", "email"]) {
    const header = document.header.items.find((item) => item.key === key);
    if (header) header.value = "***";
  }
  const experience = document.sections.find((section) => section.key === "experience");
  const company = experience?.entries[0]?.items.find(
    (item) => item.kind === "field" && item.key === "company",
  );
  if (company && company.kind === "field") company.value = "***";
  return document;
}

function renderModal() {
  return render(
    <AntdApp>
      <RedactionModal recordId={7} open onClose={vi.fn()} />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.redactResume.mockReset().mockResolvedValue(redactedDocument());
  apiMocks.exportResumeWithOptions.mockReset().mockResolvedValue({
    blob: new Blob(["pdf"]),
    filename: "简历.pdf",
    pages: null,
    pageLimit: null,
  });
  downloadMocks.downloadBlob.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("RedactionModal", () => {
  it("预览脱敏并展示遮罩后的字段", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "预览脱敏" }));

    // 姓名 / 手机 / 邮箱 / 公司都被遮成 ***。
    expect((await screen.findAllByText("***")).length).toBeGreaterThan(0);
    // 「最近公司」是预览表独有的标签（勾选区里没有），用来确认预览已渲染。
    expect(screen.getByText("最近公司")).toBeInTheDocument();
    expect(apiMocks.redactResume).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ mask_name: true, mask_company: true }),
    );
  });

  it("下载脱敏版走全参数导出（redact=true）", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "下载脱敏版（PDF）" }));

    await waitFor(() => expect(downloadMocks.downloadBlob).toHaveBeenCalledTimes(1));
    expect(apiMocks.exportResumeWithOptions).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ format: "pdf", redact: true }),
    );
  });
});
