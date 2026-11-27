// SPDX-License-Identifier: Apache-2.0
/**
 * R21：配图选择器的两套语义。
 *
 * 队列编辑（`mode="multiple"`）——本条要发：
 * 1. 已选的图是**横向缩略图**，图源 `/api/user-files/{id}/raw`（`id` 就是 `user_file.id`）；
 * 2. 缩略图点开灯箱，Esc 可关，关闭后焦点回到那张缩略图；
 * 3. `×` 只从这一条移除，**不调删除接口**（图库文件仍在）；
 * 4. 图片库默认折叠；到上限时选择入口置灰 + 一句原因，且**没有删库按钮**。
 *
 * 设置页（`mode="single"`）仍是"下拉 + 可删清单"：那里就是图片库的管理位置。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
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

const OPTIONS: ApplyGreetingImageOption[] = [
  { id: 11, name: "shot-a.png", size_bytes: 1024, deletable: true },
  { id: 12, name: "shot-b.png", size_bytes: 2048, deletable: false },
  { id: 13, name: "shot-c.png", size_bytes: 3072, deletable: true },
  { id: 14, name: "shot-d.png", size_bytes: 4096, deletable: true },
  { id: 15, name: "shot-e.png", size_bytes: 5120, deletable: true },
];

const UPLOADED: ApplyGreetingImageOption = {
  id: 99,
  name: "uploaded.png",
  size_bytes: 6144,
  deletable: true,
};

const FOUR = [11, 12, 13, 14];

function optionOf(id: number): ApplyGreetingImageOption {
  const found = OPTIONS.find((item) => item.id === id);
  if (!found) throw new Error(`missing option ${id}`);
  return found;
}

/** 库里某张图的读屏名（含名字与体积）。 */
function thumbLabel(option: ApplyGreetingImageOption): string {
  return t("applyQueue.image.toggleAria", {
    name: option.name,
    size: formatBytes(option.size_bytes),
  });
}

/** 「选择图片」槽的读屏名（含已选数与上限）。 */
function addTileLabel(count: number, max = 4): string {
  return t("applyQueue.image.addTileAria", { count, max });
}

type PickerProps = Partial<ComponentProps<typeof GreetingImagePicker>>;

function element(props: PickerProps, onChange: (next: number | number[] | null) => void) {
  return (
    <AntdApp>
      <GreetingImagePicker
        mode="multiple"
        value={[]}
        onChange={onChange}
        options={OPTIONS}
        maxCount={4}
        ariaLabel={t("applyQueue.image.editorLabel")}
        {...props}
      />
    </AntdApp>
  );
}

function renderPicker(props: PickerProps = {}) {
  const onChange = vi.fn();
  const view = render(element(props, onChange));
  // 注意顺序：`rerender` 必须放在 `...view` 之后，否则会被 Testing Library 那份覆盖。
  const rerender = (next: PickerProps) => view.rerender(element({ ...props, ...next }, onChange));
  return { ...view, onChange, rerender };
}

function pickFile(container: HTMLElement, name = "uploaded.png") {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("GreetingImagePicker（R21）", () => {
  beforeEach(() => {
    apiMocks.uploadGreetingImage.mockReset().mockResolvedValue(UPLOADED);
    apiMocks.deleteGreetingImage.mockReset().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("没选任何图时显示「跟随默认图片」，而不是一片空白", () => {
    renderPicker({ value: [] });

    expect(screen.getByText(t("applyQueue.image.followDefault"))).toBeInTheDocument();
  });

  it("已选的图渲染成缩略图，图源走 /api/user-files/{id}/raw", () => {
    renderPicker({ value: [11] });

    const preview = screen.getByRole("button", {
      name: t("applyQueue.image.previewAria", { name: "shot-a.png" }),
    });
    const img = preview.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/api/user-files/11/raw");
  });

  it("图片库默认折叠，点「选择图片」才展开", () => {
    renderPicker({ value: [] });

    // 折叠态：库里的候选一个都不在 DOM 里。
    expect(screen.queryAllByRole("button", { pressed: false })).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: addTileLabel(0) }));

    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(OPTIONS.length);
    expect(screen.getByRole("button", { name: thumbLabel(optionOf(11)) })).toBeInTheDocument();
  });

  it("库里的图可勾选：点一张就把 id 追加进这一条", () => {
    const { onChange } = renderPicker({ value: [] });

    fireEvent.click(screen.getByRole("button", { name: addTileLabel(0) }));
    fireEvent.click(screen.getByRole("button", { name: thumbLabel(optionOf(13)) }));

    expect(onChange).toHaveBeenCalledWith([13]);
  });

  it("第 5 张：选择入口置灰，并写明已达上限的原因", () => {
    const { rerender } = renderPicker({ value: [] });
    // 先把库展开，再让已选数到顶：模拟"库开着的时候选满了"。
    fireEvent.click(screen.getByRole("button", { name: addTileLabel(0) }));
    rerender({ value: FOUR });

    const addTile = screen.getByRole("button", { name: addTileLabel(4) });
    expect(addTile).toBeDisabled();
    expect(screen.getByText(t("applyQueue.image.maxReached", { count: 4 }))).toBeInTheDocument();
    // 库里未选中的那张也一并置灰，而不是点了没反应。
    expect(screen.getByRole("button", { name: thumbLabel(optionOf(15)) })).toBeDisabled();
  });

  it("未到上限时选择入口可用", () => {
    renderPicker({ value: [11] });

    expect(screen.getByRole("button", { name: addTileLabel(1) })).toBeEnabled();
  });

  it("× 只从这一条移除：改值但不调用删除接口（图库文件仍在）", async () => {
    const { onChange } = renderPicker({ value: [11, 13] });

    fireEvent.click(
      screen.getByRole("button", {
        name: t("applyQueue.image.removeAria", { name: "shot-a.png" }),
      }),
    );

    expect(onChange).toHaveBeenCalledWith([13]);
    expect(apiMocks.deleteGreetingImage).not.toHaveBeenCalled();
    // 说清楚"移除 ≠ 删除"，否则用户会以为图没了。
    expect(await screen.findByText(t("applyQueue.image.removeOnly"))).toBeInTheDocument();
  });

  it("队列编辑里不出现删库按钮（配图 ≠ 图库管理）", () => {
    renderPicker({ value: [11] });
    fireEvent.click(screen.getByRole("button", { name: addTileLabel(1) }));

    for (const option of OPTIONS) {
      expect(
        screen.queryByRole("button", {
          name: t("applyQueue.image.deleteAria", { name: option.name }),
        }),
      ).toBeNull();
    }
    expect(screen.queryByText(t("applyQueue.image.deleted"))).toBeNull();
  });

  it("点缩略图开灯箱，Esc 关闭，焦点回到那张缩略图", async () => {
    renderPicker({ value: [11] });

    const preview = screen.getByRole("button", {
      name: t("applyQueue.image.previewAria", { name: "shot-a.png" }),
    });
    // 真实浏览器里点击会先聚焦按钮，jsdom 不会，这里手动对齐后再点。
    preview.focus();
    fireEvent.click(preview);

    const dialog = await screen.findByRole("dialog");
    // 灯箱里还有 antd 图标（`role="img"` 的 span），所以按类名取那张图，不按角色取。
    const img = dialog.querySelector(".rf-greeting-lightbox-img");
    expect(img?.getAttribute("src")).toBe("/api/user-files/11/raw");
    expect(screen.getByText(t("applyQueue.image.lightboxHint"))).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(preview));
  });

  it("灯箱里的关闭按钮等价于 Esc", async () => {
    renderPicker({ value: [11] });

    fireEvent.click(
      screen.getByRole("button", {
        name: t("applyQueue.image.previewAria", { name: "shot-a.png" }),
      }),
    );
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: t("applyQueue.image.lightboxClose") }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("上传成功后新图自动选中（多选：追加到这一条）", async () => {
    const { container, onChange } = renderPicker({ value: [11] });
    // 上传入口在图片库里（折叠态不渲染），先展开。
    fireEvent.click(screen.getByRole("button", { name: addTileLabel(1) }));

    pickFile(container);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith([11, UPLOADED.id]));
    expect(apiMocks.uploadGreetingImage).toHaveBeenCalledTimes(1);
  });

  it("单选模式：上传成功直接选中那张图", async () => {
    const { container, onChange } = renderPicker({ mode: "single", value: null });

    pickFile(container);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(UPLOADED.id));
  });

  it("单选模式仍保留删库入口；仍被引用的图不给按钮，只写「使用中」", () => {
    renderPicker({ mode: "single", value: 12, options: [OPTIONS[1]] });

    expect(
      screen.queryByRole("button", {
        name: t("applyQueue.image.deleteAria", { name: "shot-b.png" }),
      }),
    ).toBeNull();
    // 不给按钮要给出原因，否则用户只会反复点（"为什么别人能删我不能"）。
    expect(screen.getByText(t("applyQueue.image.inUse"))).toBeInTheDocument();
  });

  it("单选模式删除未被引用的图：调接口并清空选中值", async () => {
    const { onChange } = renderPicker({ mode: "single", value: 11, options: [OPTIONS[0]] });

    fireEvent.click(
      screen.getByRole("button", {
        name: t("applyQueue.image.deleteAria", { name: "shot-a.png" }),
      }),
    );

    await waitFor(() => expect(apiMocks.deleteGreetingImage).toHaveBeenCalledWith(11));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
  });
});
