// SPDX-License-Identifier: Apache-2.0
/**
 * 粘贴这条路（T24）：`paste` 事件里的文件必须和「选择文件」走**同一个**上传函数。
 *
 * 四条验收都在这里：
 * 1. 粘一张图 → 真的发起上传，成功后自动选中；
 * 2. 粘一个 `.pdf` → **不发请求**，当场说明"这不是图片：xxx.pdf"；
 * 3. 粘一张超大图 → **不发请求**，说明体积超限（别让用户白等一次往返）；
 * 4. 批量里有一张失败 → 成功的那张照常进库，失败那张留在托盘里可重试。
 *
 * 另外守住一条容易写坏的行为：在输入框里粘贴**文字**不能被这里截走。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ApplyGreetingImageOption } from "../../types";
import { formatBytes } from "../../utils/format";
import GreetingImagePicker from "./GreetingImagePicker";

const apiMocks = vi.hoisted(() => ({
  uploadGreetingImage: vi.fn(),
  deleteGreetingImage: vi.fn(),
}));

vi.mock("../../api/applyExtras", () => ({
  uploadGreetingImage: apiMocks.uploadGreetingImage,
  deleteGreetingImage: apiMocks.deleteGreetingImage,
}));

const MB = 1024 * 1024;
const LIMIT = 2 * MB;

const OPTIONS: ApplyGreetingImageOption[] = [
  { id: 11, name: "shot-a.png", size_bytes: 1024, deletable: true },
];

function uploaded(id: number, name: string): ApplyGreetingImageOption {
  return { id, name, size_bytes: 1024, deletable: true };
}

/** 造一个指定体积的"图片"：只覆盖 `size`，不真的分配那么多内存。 */
function fileNamed(size: number, name: string, type: string): File {
  const blob = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(blob, "size", { value: size });
  return blob;
}

/**
 * 受控包装：`GreetingImagePicker` 的已选值是 props，真实调用方（`Form.Item`）会把新值传回来。
 * 测试里若只挂一个 mock 而不回传，第二次上传就只能读到旧值——那是测试搭建的问题，不是组件行为。
 */
function renderPicker(initial: number[] = [11]) {
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = useState<number[]>(initial);
    return (
      <GreetingImagePicker
        mode="multiple"
        value={value}
        onChange={(next) => {
          const list = Array.isArray(next) ? next : [];
          onChange(list);
          setValue(list);
        }}
        options={OPTIONS}
        maxCount={4}
        maxImageBytes={LIMIT}
        ariaLabel={t("applyQueue.image.editorLabel")}
      />
    );
  }
  render(
    <AntdApp>
      <Harness />
    </AntdApp>,
  );
  return { onChange };
}

/** antd 在两个汉字之间自动插空格（`重试` → `重 试`），按名字取按钮时放宽字间空白。 */
function buttonNamed(label: string): HTMLElement {
  const pattern = new RegExp(`^${label.split("").join("\\s*")}$`);
  return screen.getByRole("button", { name: pattern });
}

/** 粘贴：jsdom 没有真的剪贴板，直接把 `clipboardData` 挂到事件上。 */
function pasteFiles(files: File[], options: { target?: HTMLElement; text?: string } = {}): void {
  const target = options.target ?? document.body;
  fireEvent.paste(target, {
    clipboardData: {
      files,
      getData: (type: string) => (type === "text/plain" ? (options.text ?? "") : ""),
    },
  });
}

describe("配图粘贴（T24）", () => {
  beforeEach(() => {
    apiMocks.uploadGreetingImage.mockReset();
    apiMocks.deleteGreetingImage.mockReset();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("粘一张截图：走同一个上传函数，成功后自动选中", async () => {
    apiMocks.uploadGreetingImage.mockResolvedValue(uploaded(99, "pasted.png"));
    const { onChange } = renderPicker();

    pasteFiles([fileNamed(2048, "pasted.png", "image/png")]);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith([11, 99]));
    expect(apiMocks.uploadGreetingImage).toHaveBeenCalledTimes(1);
  });

  it("粘两张一起：逐张上传，两张都进这一条", async () => {
    apiMocks.uploadGreetingImage
      .mockResolvedValueOnce(uploaded(99, "one.png"))
      .mockResolvedValueOnce(uploaded(100, "two.png"));
    const { onChange } = renderPicker();

    pasteFiles([fileNamed(2048, "one.png", "image/png"), fileNamed(2048, "two.png", "image/png")]);

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([11, 99, 100]));
    expect(apiMocks.uploadGreetingImage).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByText(t("applyQueue.image.uploadedBatch", { count: 2 })),
    ).toBeInTheDocument();
  });

  it("粘一个 .pdf：不发请求，并且说清「这不是图片」", async () => {
    const { onChange } = renderPicker();

    pasteFiles([fileNamed(1024, "cv.pdf", "application/pdf")]);

    expect(
      await screen.findByText(t("applyQueue.image.rejectNotImage", { name: "cv.pdf" })),
    ).toBeInTheDocument();
    expect(apiMocks.uploadGreetingImage).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("粘一张超大图：上传前就被拦下，提示里给体积与上限", async () => {
    renderPicker();
    const big = fileNamed(12.3 * MB, "huge.png", "image/png");

    pasteFiles([big]);

    const expected = t("applyQueue.image.rejectTooLarge", {
      name: "huge.png",
      size: formatBytes(12.3 * MB),
      limit: formatBytes(LIMIT),
    });
    expect(await screen.findByText(expected)).toBeInTheDocument();
    // 关键：没有发出请求——用户不必等一次注定失败的往返。
    expect(apiMocks.uploadGreetingImage).not.toHaveBeenCalled();
    // 失败的可读原因也要留在托盘里，方便改完再试。
    expect(await screen.findByText(t("applyQueue.image.failedTray"))).toBeInTheDocument();
  });

  it("批量里一张失败：成功的照常进库，失败那张留在托盘里可重试", async () => {
    apiMocks.uploadGreetingImage
      .mockResolvedValueOnce(uploaded(99, "good.png"))
      .mockRejectedValueOnce(new Error("网络开了小差"));
    const { onChange } = renderPicker();

    pasteFiles([fileNamed(2048, "good.png", "image/png"), fileNamed(2048, "bad.png", "image/png")]);

    // 成功那张已经选中——不能因为同批里有一张失败就整批判失败。
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([11, 99]));
    expect(await screen.findByText(t("applyQueue.image.failedTray"))).toBeInTheDocument();
    expect(screen.getByText("bad.png")).toBeInTheDocument();

    // 重试：这次成功，托盘里这一条应当消失。
    apiMocks.uploadGreetingImage.mockResolvedValueOnce(uploaded(100, "bad.png"));
    fireEvent.click(buttonNamed(t("applyQueue.image.retry")));

    await waitFor(() => expect(screen.queryByText(t("applyQueue.image.failedTray"))).toBeNull());
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([11, 99, 100]));
  });

  it("在输入框里粘贴纯文字：不抢，交给输入框", async () => {
    renderPicker();
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);

    pasteFiles([], { target: textarea, text: "你好，我想应聘这个岗位" });
    // 从 Word 复制来的内容同时带 text 和 image：文字优先，别把文字吞掉。
    pasteFiles([fileNamed(2048, "word.png", "image/png")], {
      target: textarea,
      text: "项目经历",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(apiMocks.uploadGreetingImage).not.toHaveBeenCalled();
  });

  it("粘贴的图太大时也走托盘重试入口（改完压缩后可直接再试）", async () => {
    renderPicker();
    pasteFiles([fileNamed(5 * MB, "raw.png", "image/png")]);

    expect(
      await screen.findByText(
        t("applyQueue.image.rejectTooLarge", {
          name: "raw.png",
          size: formatBytes(5 * MB),
          limit: formatBytes(LIMIT),
        }),
      ),
    ).toBeInTheDocument();
    expect(apiMocks.uploadGreetingImage).not.toHaveBeenCalled();
  });
});
