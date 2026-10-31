// SPDX-License-Identifier: Apache-2.0
/** 制作台刷新预览时的视图状态：换 html 不能把用户缩放打回 fit（2026-10-29 用户要求）。 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { t } from "../i18n";
import ResumePreview from "./ResumePreview";

const HTML = "<!doctype html><html><body></body></html>";

function zoomLabel(): string | null {
  return document.querySelector<HTMLElement>(".resume-preview-zoom-label")?.textContent ?? null;
}

describe("ResumePreview · 刷新保留缩放", () => {
  it("换 html / 换页数不把用户缩放打回 fit", () => {
    const { rerender } = render(<ResumePreview html={HTML} warnings={[]} availableHeight={500} />);
    const atFloor = t("responsive.a4.minScaleLabel", { value: 55 });
    fireEvent.click(screen.getByRole("button", { name: /放大预览/ }));
    const zoomed = zoomLabel();
    expect(zoomed).not.toBe(atFloor);

    // 左栏改一个值 = 预览换一份 html：缩放必须还是用户刚调的那一档。
    rerender(
      <ResumePreview
        html="<!doctype html><html><body><p>改过参数的新预览</p></body></html>"
        warnings={[]}
        availableHeight={500}
      />,
    );
    expect(zoomLabel()).toBe(zoomed);
  });
});
