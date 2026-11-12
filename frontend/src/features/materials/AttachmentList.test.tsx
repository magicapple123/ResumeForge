// SPDX-License-Identifier: Apache-2.0
/**
 * 资料箱附件行：预览 / 复制 / 另存为。
 *
 * 重点钉住三件事（清单 §23.7）：
 * 1. 有原件才有「另存为」；历史附件只有「复制」；
 * 2. 图片复制必须把 Promise 交给 ClipboardItem（先转码再 write 会丢用户手势）；
 * 3. 点复制不触发预览，复制失败不误报成功。
 *
 * jsdom 不实现 Tab 焦点遍历，键盘顺序按 DOM 顺序 + 可聚焦性钉住；真实 Tab 顺序由
 * Playwright 实机验证（wave2/23-* 物证）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MaterialFile } from "../../types";
import { t } from "../../i18n";
import AttachmentList from "./AttachmentList";

const rawUrl = vi.hoisted(() => vi.fn((id: number) => `/api/user-files/${id}/raw`));
vi.mock("../../api/userFiles", () => ({ userFileRawUrl: rawUrl }));

// 附件名与正文刻意用 ASCII：测试文件里的中文行会进 i18n 棘轮的 tests 基线
// （新增用例应尽量用 t()/role/aria-label 定位），这些只是数据，不需要中文。
const TEXT_FILE: MaterialFile = {
  name: "governance.md",
  mime_type: "text/markdown",
  size_bytes: 1024,
  text: "# conclusion\nhit rate 43% -> 91%",
  data_url: "",
  file_id: 11,
};

const IMAGE_FILE: MaterialFile = {
  name: "latency.png",
  mime_type: "image/png",
  size_bytes: 2048,
  text: "",
  data_url: "data:image/png;base64,AAAA",
  file_id: 12,
};

/** 历史文本附件：没有原件，只显示「复制」。 */
const LEGACY_TEXT: MaterialFile = {
  name: "legacy-notes.md",
  mime_type: "text/markdown",
  size_bytes: 12,
  text: "legacy notes content",
  data_url: "",
};

/** 从 i18n 文案里取前缀（含 {name} 占位符的 key 用占位符自身调用即可）。 */
const copyPrefix = t("materials.attachments.copyAria", { name: "{name}" }).split("{name}")[0];
const saveAsPrefix = t("materials.attachments.saveAsAria", { name: "{name}" }).split("{name}")[0];
const previewPrefix = t("materials.attachments.previewAria", { name: "{name}" }).split("{name}")[0];

class FakeClipboardItem {
  static instances: FakeClipboardItem[] = [];
  items: Record<string, Promise<Blob> | Blob>;

  constructor(items: Record<string, Promise<Blob> | Blob>) {
    this.items = items;
    FakeClipboardItem.instances.push(this);
  }
}

const clipboardWrite = vi.fn();
const clipboardWriteText = vi.fn();

function defineClipboard(write = clipboardWrite, writeText = clipboardWriteText) {
  Object.defineProperty(navigator, "clipboard", {
    value: { write, writeText },
    configurable: true,
  });
}

function renderList(files: MaterialFile[], onPreview = vi.fn()) {
  render(
    <AntdApp>
      <AttachmentList files={files} onPreview={onPreview} />
    </AntdApp>,
  );
  return onPreview;
}

beforeEach(() => {
  FakeClipboardItem.instances = [];
  clipboardWrite.mockReset().mockResolvedValue(undefined);
  clipboardWriteText.mockReset().mockResolvedValue(undefined);
  defineClipboard();
  vi.stubGlobal("ClipboardItem", FakeClipboardItem);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
    callback(new Blob(["PNG"], { type: "image/png" }));
  });
  rawUrl.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AttachmentList", () => {
  it("offers copy + save-as for attachments that have an original, copy only for legacy ones", () => {
    renderList([TEXT_FILE, IMAGE_FILE, LEGACY_TEXT]);

    expect(screen.getAllByRole("button", { name: new RegExp("^" + copyPrefix) })).toHaveLength(3);
    // 两个有原件的附件才有「另存为」；历史文本附件没有。
    expect(screen.getAllByRole("button", { name: new RegExp("^" + saveAsPrefix) })).toHaveLength(2);
    // aria-label 必须带文件名：一行多个附件时读屏只念「复制」分不清。
    expect(
      screen.getByRole("button", {
        name: t("materials.attachments.copyAria", { name: TEXT_FILE.name }),
      }),
    ).toBeInTheDocument();
  });

  it("copies a document's extracted text without triggering preview", async () => {
    const onPreview = renderList([TEXT_FILE]);
    fireEvent.click(
      screen.getByRole("button", {
        name: t("materials.attachments.copyAria", { name: TEXT_FILE.name }),
      }),
    );

    await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledWith(TEXT_FILE.text));
    expect(await screen.findByText(t("materials.attachments.copyTextDone"))).toBeInTheDocument();
    expect(onPreview).not.toHaveBeenCalled();
  });

  it("writes images through ClipboardItem with a Promise value (keeps the user gesture)", async () => {
    renderList([IMAGE_FILE]);
    fireEvent.click(
      screen.getByRole("button", {
        name: t("materials.attachments.copyAria", { name: IMAGE_FILE.name }),
      }),
    );

    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledTimes(1));
    expect(FakeClipboardItem.instances).toHaveLength(1);
    const entry = FakeClipboardItem.instances[0].items["image/png"];
    // 关键：传进来的是 Promise，不是已完成的 Blob（清单 §23.4 / §23.8）。
    expect(entry).toBeInstanceOf(Promise);
    const blob = await entry;
    expect(blob.type).toBe("image/png");
  });

  it("does not fake success when the browser cannot copy images", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    renderList([IMAGE_FILE]);
    fireEvent.click(
      screen.getByRole("button", {
        name: t("materials.attachments.copyAria", { name: IMAGE_FILE.name }),
      }),
    );

    expect(
      await screen.findByText(t("materials.attachments.copyImageUnsupported")),
    ).toBeInTheDocument();
    expect(clipboardWrite).not.toHaveBeenCalled();
  });

  it("reports a failed copy instead of pretending it worked", async () => {
    clipboardWriteText.mockRejectedValue(new Error("denied"));
    // jsdom 没有 execCommand：copyText 的兜底也会失败，于是返回 false。
    renderList([TEXT_FILE]);
    fireEvent.click(
      screen.getByRole("button", {
        name: t("materials.attachments.copyAria", { name: TEXT_FILE.name }),
      }),
    );

    expect(await screen.findByText(t("materials.attachments.copyFailed"))).toBeInTheDocument();
  });

  it("triggers a download from the raw endpoint and never invents a filename", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderList([TEXT_FILE]);
    fireEvent.click(
      screen.getByRole("button", {
        name: t("materials.attachments.saveAsAria", { name: TEXT_FILE.name }),
      }),
    );

    expect(rawUrl).toHaveBeenCalledWith(TEXT_FILE.file_id);
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.href).toContain("/api/user-files/11/raw");
    // 空 download = 文件名交给后端 Content-Disposition，前端不自己拼。
    expect(anchor.getAttribute("download")).toBe("");
  });

  it("previews once per open click and keeps the three actions in DOM order", () => {
    const onPreview = renderList([TEXT_FILE]);
    const buttons = screen.getAllByRole("button");
    // 一行三个操作：预览（打开区）→ 复制 → 另存为。
    expect(buttons).toHaveLength(3);
    expect(buttons[0].getAttribute("aria-label")).toContain(previewPrefix);
    expect(buttons[1].getAttribute("aria-label")).toContain(copyPrefix);
    expect(buttons[2].getAttribute("aria-label")).toContain(saveAsPrefix);
    for (const button of buttons) expect(button.tabIndex).toBeGreaterThanOrEqual(0);

    fireEvent.click(buttons[0]);
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledWith(TEXT_FILE);
  });
});
