// SPDX-License-Identifier: Apache-2.0
/** 上传外部简历弹窗：选文件 / 名称回填 / 客户端挡非法文件 / 提交与关闭。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import ExternalResumeUploadModal from "./ExternalResumeUploadModal";

const jobMocks = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn() }));
vi.mock("../../../api/jobs", () => jobMocks);

function renderModal(onSubmit = vi.fn().mockResolvedValue(true)) {
  const onClose = vi.fn();
  render(
    <AntdApp>
      <ExternalResumeUploadModal open uploading={false} onClose={onClose} onSubmit={onSubmit} />
    </AntdApp>,
  );
  return { onClose, onSubmit };
}

function chooseFile(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("弹窗里没有文件输入框");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

function submitButton() {
  return screen.getByRole("button", { name: t("resumesPage.external.upload") });
}

beforeEach(() => {
  jobMocks.listJobs.mockReset().mockResolvedValue({ items: [], total: 0 });
  jobMocks.getJob.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ExternalResumeUploadModal", () => {
  it("选好文件后回填显示名，提交把文件与名称/岗位交给上层，成功才关闭", async () => {
    const { onClose, onSubmit } = renderModal();
    chooseFile(new File(["resume text"], "我的简历.txt", { type: "text/plain" }));

    await waitFor(() => expect(screen.getByDisplayValue("我的简历")).toBeInTheDocument());
    fireEvent.click(submitButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [file, options] = onSubmit.mock.calls[0];
    expect(file.name).toBe("我的简历.txt");
    expect(options).toEqual({ name: "我的简历", jobId: null });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("没选文件就提交：给出提示且不发起上传", async () => {
    const { onSubmit } = renderModal();

    fireEvent.click(submitButton());

    expect(await screen.findByText(t("resumesPage.external.uploadRequired"))).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("选到不支持的格式：当场拒绝，不发请求", async () => {
    const { onSubmit } = renderModal();

    chooseFile(new File(["GIF89a"], "resume.png", { type: "image/png" }));

    expect(
      await screen.findByText(t("resumesPage.external.uploadUnsupported")),
    ).toBeInTheDocument();
    fireEvent.click(submitButton());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("上层返回 false（上传失败）：弹窗不关闭，用户可原地重试", async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);
    const { onClose } = renderModal(onSubmit);
    chooseFile(new File(["resume text"], "retry.txt", { type: "text/plain" }));

    await waitFor(() => expect(screen.getByDisplayValue("retry")).toBeInTheDocument());
    fireEvent.click(submitButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
  });
});
