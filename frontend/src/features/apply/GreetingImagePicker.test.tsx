// SPDX-License-Identifier: Apache-2.0
/**
 * CR-18：队列行与设置页共用的配图选择器。
 *
 * 三条判据：
 * 1. 上传成功后新图**自动选中**（用户不用再回下拉里找一遍）；
 * 2. 可删性听后端的 ``deletable``：仍被引用的图不出现删除入口；
 * 3. 删除后从候选里消失，且已选中的值被一并清掉。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import GreetingImagePicker from "./GreetingImagePicker";

const apiMocks = vi.hoisted(() => ({
  uploadGreetingImage: vi.fn(),
  deleteGreetingImage: vi.fn(),
}));

vi.mock("../../api/applyExtras", () => ({
  uploadGreetingImage: apiMocks.uploadGreetingImage,
  deleteGreetingImage: apiMocks.deleteGreetingImage,
}));

const OPTION = { id: 11, name: "旧配图.png", size_bytes: 1024, deletable: true };
const UPLOADED = { id: 12, name: "新配图.png", size_bytes: 2048, deletable: true };

function renderPicker(props: Partial<ComponentProps<typeof GreetingImagePicker>> = {}) {
  const onChange = vi.fn();
  const view = render(
    <AntdApp>
      <GreetingImagePicker
        mode="multiple"
        value={[]}
        onChange={onChange}
        options={[OPTION]}
        maxCount={4}
        ariaLabel={t("applyQueue.image.editorLabel")}
        {...props}
      />
    </AntdApp>,
  );
  return { onChange, ...view };
}

function pickFile(container: HTMLElement, name = "新配图.png") {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("GreetingImagePicker（CR-18）", () => {
  beforeEach(() => {
    apiMocks.uploadGreetingImage.mockReset().mockResolvedValue(UPLOADED);
    apiMocks.deleteGreetingImage.mockReset().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("上传成功后把新图追加进已选值", async () => {
    const { container, onChange } = renderPicker({ value: [OPTION.id] });

    pickFile(container);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith([OPTION.id, UPLOADED.id]));
    expect(apiMocks.uploadGreetingImage).toHaveBeenCalledTimes(1);
  });

  it("单选模式下上传成功直接选中那张图", async () => {
    const { container, onChange } = renderPicker({ mode: "single", value: null });

    pickFile(container);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(UPLOADED.id));
  });

  it("仍被引用的图不给删除入口", () => {
    renderPicker({ value: [OPTION.id], options: [{ ...OPTION, deletable: false }] });

    expect(
      screen.queryByRole("button", {
        name: t("applyQueue.image.deleteAria", { name: OPTION.name }),
      }),
    ).toBeNull();
    // 不给按钮要给出原因，否则用户只会反复点（"为什么别人能删我不能"）。
    expect(screen.getByText(t("applyQueue.image.inUse"))).toBeInTheDocument();
  });

  it("删除未被引用的图：调接口并从选中值里摘掉", async () => {
    const { onChange } = renderPicker({ value: [OPTION.id] });

    fireEvent.click(
      screen.getByRole("button", {
        name: t("applyQueue.image.deleteAria", { name: OPTION.name }),
      }),
    );

    await waitFor(() => expect(apiMocks.deleteGreetingImage).toHaveBeenCalledWith(OPTION.id));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([]));
  });
});
