// SPDX-License-Identifier: Apache-2.0
/** W12 采纳弹窗：粘贴文本 → 写回；业务码 stale/fact_lock 给出可执行说明。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../api/client";
import { pt } from "../../../features/resume-provenance/i18n";
import SourceAdoptModal from "./SourceAdoptModal";

const apiMocks = vi.hoisted(() => ({
  adoptSourceLink: vi.fn(),
  fetchRevisionText: vi.fn(),
}));
vi.mock("../../../features/resume-provenance/api", () => apiMocks);

const ENTRY = {
  resume_id: 5,
  resume_title: "简历",
  link_id: 71,
  source_id: 9,
  object_id: "exp_1",
  point_id: null,
  path: "experience.0.company",
  field: "company",
  linked_fingerprint: "fp-1",
  current_fingerprint: "fp-2",
  stale: true,
  resume_deleted: false,
};

beforeEach(() => {
  // 默认模拟手工来源：没有可读取原文，输入框保持空、由用户粘贴。
  apiMocks.fetchRevisionText.mockResolvedValue({
    source_id: 9,
    kind: "manual",
    external_ref: null,
    revision_no: 2,
    text: "",
    fingerprint: "fp",
    resolvable: false,
    fingerprint_matched: false,
    is_latest: true,
    reason: "manual_source_has_no_body",
  });
  apiMocks.adoptSourceLink.mockResolvedValue({
    resume_id: 5,
    revision: 6,
    content: {},
    applied_path: "experience.0.company",
    link: {},
    source_revision_no: 2,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderModal(onAdopted = vi.fn()) {
  render(
    <AntdApp>
      <SourceAdoptModal open entry={ENTRY} onCancel={vi.fn()} onAdopted={onAdopted} />
    </AntdApp>,
  );
  return { onAdopted };
}

describe("SourceAdoptModal", () => {
  it("空文本不发请求；填写后写回这一个块", async () => {
    const { onAdopted } = renderModal();
    const submit = screen.getByRole("button", {
      name: pt("provenance.adopt.submit"),
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(pt("provenance.adopt.text")), {
      target: { value: "Cloud Commerce Ltd" },
    });
    fireEvent.click(submit);
    await waitFor(() => expect(apiMocks.adoptSourceLink).toHaveBeenCalledTimes(1));
    expect(apiMocks.adoptSourceLink.mock.calls[0][0]).toBe(71);
    expect(apiMocks.adoptSourceLink.mock.calls[0][1]).toMatchObject({
      text: "Cloud Commerce Ltd",
      path: "experience.0.company",
    });
    expect(onAdopted).toHaveBeenCalledWith("experience.0.company");
  });

  it("source_revision_stale：提示先刷新来源，不误报成功", async () => {
    apiMocks.adoptSourceLink.mockRejectedValue(
      new ApiError("stale", 409, { businessCode: "source_revision_stale" }),
    );
    const { onAdopted } = renderModal();
    fireEvent.change(screen.getByLabelText(pt("provenance.adopt.text")), {
      target: { value: "new" },
    });
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.adopt.submit") }));
    expect(await screen.findByText(pt("provenance.adopt.stale"))).toBeTruthy();
    expect(onAdopted).not.toHaveBeenCalled();
  });

  it("fact_lock_conflict：逐条列出锁定值 → 当前值", async () => {
    apiMocks.adoptSourceLink.mockRejectedValue(
      new ApiError("conflict", 409, {
        businessCode: "fact_lock_conflict",
        payload: {
          violations: [
            {
              lock_id: 9,
              kind: "institution",
              label: "company",
              path: "experience.0.company",
              field: "company",
              reason: "value changed",
              locked_value: "Cloud Commerce Ltd",
              current_value: "Cloud Commerce Limited",
            },
          ],
        },
      }),
    );
    renderModal();
    fireEvent.change(screen.getByLabelText(pt("provenance.adopt.text")), {
      target: { value: "new" },
    });
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.adopt.submit") }));
    expect(
      await screen.findByText(
        pt("provenance.lock.violationLine", {
          label: "company",
          locked: "Cloud Commerce Ltd",
          current: "Cloud Commerce Limited",
        }),
      ),
    ).toBeTruthy();
  });

  it("来源可读原文时预填并显示修订号，提交用预填文本", async () => {
    apiMocks.fetchRevisionText.mockResolvedValue({
      source_id: 9,
      kind: "claim",
      external_ref: "claim_record:1",
      revision_no: 3,
      text: "Source body text",
      fingerprint: "fp3",
      resolvable: true,
      fingerprint_matched: true,
      is_latest: true,
      reason: "",
    });
    const { onAdopted } = renderModal();
    expect(await screen.findByText(pt("provenance.adopt.revisionText", { no: 3 }))).toBeTruthy();
    const textarea = screen.getByLabelText(pt("provenance.adopt.text")) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Source body text");
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.adopt.submit") }));
    await waitFor(() => expect(apiMocks.adoptSourceLink).toHaveBeenCalledTimes(1));
    expect(apiMocks.adoptSourceLink.mock.calls[0][1]).toMatchObject({
      text: "Source body text",
    });
    expect(onAdopted).toHaveBeenCalled();
  });

  it("来源没有可读原文时说明原因并保持空输入", async () => {
    renderModal();
    expect(await screen.findByText(pt("provenance.adopt.unresolvable"))).toBeTruthy();
    const textarea = screen.getByLabelText(pt("provenance.adopt.text")) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
  });

  it("用户改到与来源指纹不一致时提示，但仍允许提交（后端 409 兜底）", async () => {
    apiMocks.fetchRevisionText.mockResolvedValue({
      source_id: 9,
      kind: "claim",
      external_ref: "claim_record:1",
      revision_no: 3,
      text: "Source body text",
      fingerprint: "fp3",
      resolvable: true,
      fingerprint_matched: true,
      is_latest: true,
      reason: "",
    });
    renderModal();
    await screen.findByText(pt("provenance.adopt.revisionText", { no: 3 }));
    fireEvent.change(screen.getByLabelText(pt("provenance.adopt.text")), {
      target: { value: "Edited body text" },
    });
    expect(await screen.findByText(pt("provenance.adopt.fingerprintMismatch"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.adopt.submit") }));
    await waitFor(() => expect(apiMocks.adoptSourceLink).toHaveBeenCalledTimes(1));
    expect(apiMocks.adoptSourceLink.mock.calls[0][1]).toMatchObject({ text: "Edited body text" });
  });
});
