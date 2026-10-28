// SPDX-License-Identifier: Apache-2.0
/** 简历写作增强面板：操作切换、调用接口、结果展示与复制。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import ResumeWritingPanel from "./ResumeWritingPanel";

const apiMocks = vi.hoisted(() => ({
  rewriteStar: vi.fn(),
  generatePhrases: vi.fn(),
  polishResumeText: vi.fn(),
  translateResumeText: vi.fn(),
}));

const clipboardMock = vi.hoisted(() => ({ copyText: vi.fn() }));

vi.mock("../api/resumeWriting", () => apiMocks);
vi.mock("../utils/clipboard", () => clipboardMock);

function renderPanel() {
  return render(
    <AntdApp>
      <ResumeWritingPanel resumeId={7} initialText="负责后端服务开发" />
    </AntdApp>,
  );
}

beforeEach(() => {
  for (const mock of Object.values(apiMocks)) mock.mockReset();
  clipboardMock.copyText.mockReset();
  clipboardMock.copyText.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumeWritingPanel", () => {
  it("没有可写目标时动作是「复制」（回填无处可去）", async () => {
    apiMocks.rewriteStar.mockResolvedValue({ result: "负责后端服务开发，性能提升 30%" });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /生\s*成/ }));

    expect(await screen.findByText(/性能提升 30%/)).toBeInTheDocument();
    expect(apiMocks.rewriteStar).toHaveBeenCalledWith(
      7,
      "负责后端服务开发",
      undefined,
      // T04-d：生成可被「停止」掐断，末尾参数是 AbortSignal。
      expect.anything(),
    );

    // 不传 `onApply` = 宿主没有可写目标（右键落在普通段落上），此时只能复制。
    expect(screen.queryByRole("button", { name: "回填" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /复\s*制/ }));
    expect(clipboardMock.copyText).toHaveBeenCalledWith("负责后端服务开发，性能提升 30%");
  });

  it("有可写目标时动作是「回填」：结果交给宿主写回选区，不碰剪贴板", async () => {
    apiMocks.rewriteStar.mockResolvedValue({ result: "改写后的句子" });
    const onApply = vi.fn();
    render(
      <AntdApp>
        <ResumeWritingPanel resumeId={7} initialText="负责后端服务开发" onApply={onApply} />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole("button", { name: /生\s*成/ }));
    fireEvent.click(await screen.findByRole("button", { name: /回\s*填/ }));

    expect(onApply).toHaveBeenCalledWith("改写后的句子");
    // 回填与复制是两条互斥的出路：能写回就不该再往剪贴板塞一份。
    expect(clipboardMock.copyText).not.toHaveBeenCalled();
  });

  it("复制失败时给出可操作的提示，而不是假装成功", async () => {
    apiMocks.rewriteStar.mockResolvedValue({ result: "结果文本" });
    clipboardMock.copyText.mockResolvedValue(false);
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /生\s*成/ }));
    fireEvent.click(await screen.findByRole("button", { name: /复\s*制/ }));

    expect(await screen.findByText(t("writing.copy.failed"))).toBeInTheDocument();
  });

  it("话术生成展示三种版式", async () => {
    apiMocks.generatePhrases.mockResolvedValue({
      star: "STAR 改写结果",
      resume: "简历话术",
      interview: "口述内容",
    });
    renderPanel();

    fireEvent.click(screen.getByText("话术生成"));
    fireEvent.click(screen.getByRole("button", { name: /生\s*成/ }));

    expect(await screen.findByText("STAR 改写结果")).toBeInTheDocument();
    expect(screen.getByText("简历话术")).toBeInTheDocument();
    expect(screen.getByText("口述内容")).toBeInTheDocument();
    expect(apiMocks.generatePhrases).toHaveBeenCalledWith(
      7,
      "负责后端服务开发",
      ["star", "resume", "interview"],
      // T04-d：生成可被「停止」掐断，末尾参数是 AbortSignal。
      expect.anything(),
    );
  });

  it("接口报错时透出中文错误", async () => {
    apiMocks.rewriteStar.mockRejectedValue(new Error("STAR 改写失败：模型未返回有效结果"));
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /生\s*成/ }));

    expect(await screen.findByText(/STAR 改写失败/)).toBeInTheDocument();
  });
});
