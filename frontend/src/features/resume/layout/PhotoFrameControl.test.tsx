// SPDX-License-Identifier: Apache-2.0
/**
 * 照片边框与位置（R-07 / R-10）：读写契约。
 *
 * 后端断言在 `backend/tests/test_resume_photo_frame.py`（HTML 规则、PDF 矩形、Word 边框）；
 * 这里只钉"控件写进 format_config 的形状"与"默认值等于模板现值"。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import PhotoFrameControl, {
  PHOTO_FRAME_BOUNDS,
  photoFrameCustomized,
  readPhotoFrame,
  withPhotoFrame,
} from "./PhotoFrameControl";

afterEach(cleanup);

describe("照片边框读写契约", () => {
  it("默认值等于模板现值：1px / 跟随线色 / 4px / 无偏移", () => {
    expect(readPhotoFrame({})).toEqual({ width: 1, color: "", radius: 4, offsetX: 0, offsetY: 0 });
    expect(photoFrameCustomized({})).toBe(false);
  });

  it("写：等于默认就删键（「没调过」只有一种形态），颜色小写落库", () => {
    expect(withPhotoFrame({}, "photo_border_width", 3)).toEqual({ photo_border_width: 3 });
    expect(withPhotoFrame({ photo_border_width: 3 }, "photo_border_width", 1)).toEqual({});
    expect(withPhotoFrame({}, "photo_border_color", "#AABBCC")).toEqual({
      photo_border_color: "#aabbcc",
    });
    expect(withPhotoFrame({}, "photo_offset_x", 2.5)).toEqual({ photo_offset_x: 2.5 });
    // 其余覆盖原样保留。
    expect(withPhotoFrame({ accent: "#123456" }, "photo_radius", 8)).toEqual({
      accent: "#123456",
      photo_radius: 8,
    });
  });

  it("越界值由后端白名单兜底，控件只负责不下发非法数字", () => {
    expect(PHOTO_FRAME_BOUNDS.photo_border_width).toMatchObject({ min: 0, max: 8, fallback: 1 });
    expect(PHOTO_FRAME_BOUNDS.photo_offset_y).toMatchObject({ min: -20, max: 20, fallback: 0 });
    expect(withPhotoFrame({}, "photo_offset_y", Number.NaN)).toEqual({});
  });
});

describe("照片边框控件", () => {
  it("打开弹层改边框粗细 → onChange 收到 photo_border_width", async () => {
    const onChange = vi.fn();
    render(
      <AntdApp>
        <PhotoFrameControl formatConfig={{}} onChange={onChange} />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole("button", { name: t("resume.photo.frame.open") }));
    const input = await screen.findByRole("spinbutton", {
      name: t("resume.photo.frame.width"),
    });
    fireEvent.change(input, { target: { value: "3" } });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange).toHaveBeenLastCalledWith({ photo_border_width: 3 });
  });

  it("四项都有滑杆（数字框保留精确输入）", async () => {
    render(
      <AntdApp>
        <PhotoFrameControl formatConfig={{}} onChange={vi.fn()} />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole("button", { name: t("resume.photo.frame.open") }));
    for (const key of [
      "resume.photo.frame.width",
      "resume.photo.frame.radius",
      "resume.photo.frame.offsetX",
      "resume.photo.frame.offsetY",
    ] as const) {
      expect(await screen.findByRole("slider", { name: t(key) })).toBeInTheDocument();
      expect(screen.getByRole("spinbutton", { name: t(key) })).toBeInTheDocument();
    }
    // 颜色行没有滑杆：它在弹层里横跨后两列，仍然只有取色器。
    expect(screen.queryByRole("slider", { name: t("resume.photo.frame.color") })).toBeNull();
    // 步进与单位必须写在面板里：0.5mm 的偏移拖不出来，用户要知道该去数字框敲。
    expect(screen.getByText(t("resume.photo.frame.stepHint"))).toBeInTheDocument();
  });

  it("连续拖 10 步只提交 1 次（120ms 防抖）", async () => {
    const onChange = vi.fn();
    render(
      <AntdApp>
        <PhotoFrameControl formatConfig={{}} onChange={onChange} />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole("button", { name: t("resume.photo.frame.open") }));
    const input = await screen.findByRole("spinbutton", {
      name: t("resume.photo.frame.width"),
    });
    // 同一轮事件里连改 10 次：每次都会重置定时器，只有最后一次落库。
    for (let step = 1; step <= 10; step += 1) {
      fireEvent.change(input, { target: { value: String((step % 8) + 1) } });
    }
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("拖动中注入探针，规则与后端 format_css 同形", async () => {
    const onProbe = vi.fn();
    render(
      <AntdApp>
        <PhotoFrameControl formatConfig={{}} onChange={vi.fn()} onProbe={onProbe} />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole("button", { name: t("resume.photo.frame.open") }));
    const input = await screen.findByRole("spinbutton", {
      name: t("resume.photo.frame.offsetX"),
    });
    fireEvent.change(input, { target: { value: "2.5" } });
    // 探针先于提交：不等 120ms 就已经有一条 `.profile-photo` 规则。
    expect(onProbe).toHaveBeenLastCalledWith(
      ".profile-photo { border: 1px solid var(--line); border-radius: 4px; transform: translate(2.5mm, 0mm) }",
    );
  });

  it("关闭弹层时把未提交的那次立刻送出，再清探针", async () => {
    const onChange = vi.fn();
    const onProbe = vi.fn();
    render(
      <AntdApp>
        <PhotoFrameControl formatConfig={{}} onChange={onChange} onProbe={onProbe} />
      </AntdApp>,
    );
    const trigger = screen.getByRole("button", { name: t("resume.photo.frame.open") });
    fireEvent.click(trigger);
    const input = await screen.findByRole("spinbutton", {
      name: t("resume.photo.frame.radius"),
    });
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.click(trigger);
    expect(onChange).toHaveBeenLastCalledWith({ photo_radius: 12 });
    expect(onProbe).toHaveBeenLastCalledWith("");
  });

  it("已调整时按钮文案变成「已调整…」；没有照片时禁用", () => {
    const { unmount } = render(
      <AntdApp>
        <PhotoFrameControl formatConfig={{ photo_radius: 10 }} onChange={vi.fn()} />
      </AntdApp>,
    );
    expect(
      screen.getByRole("button", { name: t("resume.photo.frame.openCustom") }),
    ).toBeInTheDocument();
    unmount();

    render(
      <AntdApp>
        <PhotoFrameControl formatConfig={{}} hasPhoto={false} onChange={vi.fn()} />
      </AntdApp>,
    );
    expect(screen.getByRole("button", { name: t("resume.photo.frame.open") })).toBeDisabled();
  });
});
