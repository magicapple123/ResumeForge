// SPDX-License-Identifier: Apache-2.0
/**
 * 全局拖入导入（R17）：按扩展名分发，不支持的给明确提示。
 *
 * 这里只钉三件最容易坏的事：遮罩真的会出现（否则用户不知道能不能松手）、
 * `.zip`/`.json` 走的是各自的确认流程、以及不支持的类型不会被当成"什么都没发生"。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GlobalFileDrop from "./GlobalFileDrop";

const apiMocks = vi.hoisted(() => ({
  createManualResume: vi.fn(),
  importDataset: vi.fn(),
}));

vi.mock("../api/resumes", () => apiMocks);
vi.mock("../api/settings", () => apiMocks);

function renderDrop() {
  return render(
    <MemoryRouter>
      <AntdApp>
        <GlobalFileDrop />
      </AntdApp>
    </MemoryRouter>,
  );
}

function dropFile(name: string, content = "") {
  const file = new File([content], name, { type: "application/octet-stream" });
  fireEvent.drop(window, { dataTransfer: { files: [file], types: ["Files"] } });
  return file;
}

beforeEach(() => {
  apiMocks.createManualResume.mockReset().mockResolvedValue({ id: 1, title: "导入的简历" });
  apiMocks.importDataset.mockReset().mockResolvedValue({ id: "new", name: "备份" });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("GlobalFileDrop", () => {
  it("拖文件进窗口时显示投放遮罩，松手后消失", () => {
    renderDrop();

    fireEvent.dragEnter(window, { dataTransfer: { types: ["Files"] } });
    expect(screen.getByText("松开即可导入")).toBeInTheDocument();

    dropFile("resume.txt");
    expect(screen.queryByText("松开即可导入")).not.toBeInTheDocument();
  });

  it("不支持的类型明确提示，而不是静默忽略", async () => {
    renderDrop();

    dropFile("notes.txt");

    expect(await screen.findByText(/不支持的文件类型「\.txt」/)).toBeInTheDocument();
    expect(apiMocks.importDataset).not.toHaveBeenCalled();
    expect(apiMocks.createManualResume).not.toHaveBeenCalled();
  });

  it(".zip 走数据集导入的二次确认", async () => {
    renderDrop();

    dropFile("校招线.zip");

    expect((await screen.findAllByText("导入备份包为新数据集？")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /导\s*入/ }));

    await waitFor(() => expect(apiMocks.importDataset).toHaveBeenCalledTimes(1));
    const [file, name, allowPartial] = apiMocks.importDataset.mock.calls[0];
    expect((file as File).name).toBe("校招线.zip");
    expect(name).toBe("校招线");
    expect(allowPartial).toBe(false);
  });

  it("拖入的整包只恢复了一部分时，点名没恢复成功的那几份", async () => {
    // R16：一份子包坏了不影响其它份，所以"导入成功"之外必须说清哪几份没进来。
    apiMocks.importDataset.mockResolvedValue({
      id: "new",
      name: "校招线",
      restored_datasets: [{ id: "other", name: "社招线" }],
      failed: [{ id: "aaa", name: "实习线", error: "子包已损坏，无法读取" }],
      skipped: [],
      summary: { restored: 2, skipped: 0, failed: 1 },
    });
    renderDrop();

    dropFile("校招线.zip");
    fireEvent.click(await screen.findByRole("button", { name: /导\s*入/ }));

    expect(await screen.findByText(/1 份数据集失败/)).toBeInTheDocument();
    expect(screen.getByText(/实习线：子包已损坏/)).toBeInTheDocument();
    expect(screen.getByText(/已导入数据集「校招线」/)).toBeInTheDocument();
  });

  it(".json 作为一份新简历导入，目录名去掉扩展名作标题", async () => {
    renderDrop();

    dropFile("张三-后端.json", JSON.stringify({ name: "张三", summary: "关注后端。" }));

    expect((await screen.findAllByText("从 JSON 新建一份简历？")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /新建简历/ }));

    await waitFor(() => expect(apiMocks.createManualResume).toHaveBeenCalledTimes(1));
    expect(apiMocks.createManualResume).toHaveBeenCalledWith({
      title: "张三-后端",
      content: { name: "张三", summary: "关注后端。" },
    });
  });

  it("JSON 坏掉时报错且不创建", async () => {
    renderDrop();

    dropFile("坏了.json", "{不是 JSON");
    fireEvent.click(await screen.findByRole("button", { name: /新建简历/ }));

    expect(await screen.findByText(/JSON 解析失败/)).toBeInTheDocument();
    expect(apiMocks.createManualResume).not.toHaveBeenCalled();
  });
});
