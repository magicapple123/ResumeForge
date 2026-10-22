// SPDX-License-Identifier: Apache-2.0
/**
 * 照片大小控件：百分比读数、双击复位、拖动的探针，以及"没有照片时禁用并说明原因"。
 *
 * 这一组断言守的是三件容易退化的性质：
 * 1. **读数写百分比而不是系数**（用户想的是"照片多大"，不是"系数多少"）；
 * 2. **拖动先给探针、再防抖提交**（松手前后必须是同一条规则）；
 * 3. **没有照片时滑杆禁用**——`photo_scale` 在这种状态下完全惰性，让用户拖一个
 *    "什么都没发生"的滑杆是最差的反馈。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import PhotoScaleControl from "./PhotoScaleControl";

function renderControl(props: Partial<ComponentProps<typeof PhotoScaleControl>> = {}) {
  const onChange = vi.fn();
  const onProbe = vi.fn();
  render(
    <AntdApp>
      <PhotoScaleControl
        value={100}
        customized={false}
        onChange={onChange}
        onProbe={onProbe}
        {...props}
      />
    </AntdApp>,
  );
  return { onChange, onProbe };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("PhotoScaleControl · 读数与来源", () => {
  it("没设过时读数 100%、来源标「随模板」", async () => {
    renderControl();
    expect(await screen.findByText("100%")).toBeInTheDocument();
    expect(screen.getByText(t("resume.photo.scale.hintTemplate"))).toBeInTheDocument();
  });

  it("设过 1.5 时读数 150%，并且不再标来源", async () => {
    renderControl({ value: 150, customized: true });
    expect(await screen.findByText("150%")).toBeInTheDocument();
    expect(screen.queryByText(t("resume.photo.scale.hintTemplate"))).not.toBeInTheDocument();
  });
});

describe("PhotoScaleControl · 交互", () => {
  it("「放大照片」一次 +2%，拖动中先给探针，静置后提交百分比", async () => {
    const { onChange, onProbe } = renderControl();

    fireEvent.click(await screen.findByRole("button", { name: t("resume.photo.scale.increase") }));

    // 探针写的是 :root 变量（照片尺寸由模板 CSS 的 var(--photo-scale, 1) 决定）。
    expect(onProbe).toHaveBeenLastCalledWith(":root { --photo-scale: 1.02; }");
    // 拖动中不提交（一次拖动应折叠成一次请求）。
    expect(onChange).not.toHaveBeenCalled();

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith(102);
  });

  it("拖回 100% 时探针是空串（与「从没设过」等价）", async () => {
    const { onProbe } = renderControl({ value: 102, customized: true });

    fireEvent.click(await screen.findByRole("button", { name: t("resume.photo.scale.decrease") }));

    expect(onProbe).toHaveBeenLastCalledWith("");
  });

  it("双击标题 = 删键（传 null），并清掉探针", async () => {
    const { onChange, onProbe } = renderControl({ value: 150, customized: true });

    fireEvent.doubleClick(await screen.findByText(t("resume.photo.scale.label")));

    expect(onProbe).toHaveBeenLastCalledWith("");
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("没设过时双击标题不产生变更（避免一次「看起来没变」的提交）", async () => {
    const { onChange } = renderControl();

    fireEvent.doubleClick(await screen.findByText(t("resume.photo.scale.label")));

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("PhotoScaleControl · 没有照片时禁用并说明原因", () => {
  it("hasPhoto=false：滑杆禁用、读数仍在、来源位写「未上传照片」", async () => {
    renderControl({ hasPhoto: false });

    const slider = await screen.findByRole("slider", { name: t("resume.photo.scale.sliderLabel") });
    expect(slider).toHaveAttribute("aria-disabled", "true");
    // 读数仍然显示："这一项现在是多少"在禁用态下依然是有用的信息。
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText(t("resume.photo.scale.noPhoto"))).toBeInTheDocument();
  });

  it("hasPhoto=false：两侧 ± 按钮也禁用", async () => {
    renderControl({ hasPhoto: false });

    expect(
      await screen.findByRole("button", { name: t("resume.photo.scale.increase") }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: t("resume.photo.scale.decrease") })).toBeDisabled();
  });

  it("hasPhoto 未传（生成前配置阶段）：不禁用，只是没有即时预览", async () => {
    renderControl();

    const slider = await screen.findByRole("slider", { name: t("resume.photo.scale.sliderLabel") });
    expect(slider).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText(t("resume.photo.scale.noPhoto"))).not.toBeInTheDocument();
  });
});
