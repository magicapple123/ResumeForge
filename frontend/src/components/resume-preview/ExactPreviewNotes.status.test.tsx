// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览底部状态行的页数措辞：**「不限篇幅」不许写成「（上限 0 页）」**。
 *
 * 0 是「不限」这个语义值，不是"设成 0 页"。把它当数字填进「上限 {limit} 页」的模板，
 * 用户读到的是"精确预览 · 实际 2 页（上限 0 页）"——既自相矛盾，又像是画布算错了。
 * 不限时改走 `exact.status.pagesNoLimit`（原 key 的措辞一个字都没改）。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { PreviewShot } from "./previewPages";
import { ExactPreviewStatus } from "./ExactPreviewNotes";

/** 一版结果：页数由 `pages` 数组长度决定（P3-2 起纸面是逐页位图，没有单独的页数字段）。 */
function shot(pages: number): PreviewShot {
  return {
    key: "k1",
    token: "token-1",
    pages: Array.from({ length: pages }, (_, index) => ({
      index,
      width: 1800,
      height: 2546,
    })),
    pagesNeeded: pages,
    overflow: false,
  };
}

function renderStatus(pageLimit: number, pages = 2) {
  return render(
    <ExactPreviewStatus
      current={shot(pages)}
      busy={false}
      pageLimit={pageLimit}
      headingSerif={false}
      active
      onOpenInNewTab={vi.fn()}
    />,
  );
}

function statusText(container: HTMLElement): string {
  return container.querySelector(".exact-preview-status")?.textContent ?? "";
}

afterEach(cleanup);

describe("ExactPreviewStatus · 页数措辞", () => {
  it("不限篇幅：说「不限篇幅」，不说「上限 0 页」", () => {
    const { container } = renderStatus(0, 2);
    const text = statusText(container);
    expect(text).toContain(t("exact.status.pagesNoLimit", { pages: 2 }));
    // 反例：把 0 直接塞进「上限 {limit} 页」会出现的那句话，一个字符都不许有。
    expect(text).not.toContain(t("exact.status.pages", { pages: 2, limit: 0 }));
  });

  it("有上限时仍是「（上限 2 页）」（旧文案逐字不变）", () => {
    const { container } = renderStatus(2, 2);
    const text = statusText(container);
    expect(text).toContain(t("exact.status.pages", { pages: 2, limit: 2 }));
    expect(text).not.toContain(t("exact.status.pagesNoLimit", { pages: 2 }));
  });

  it("重排中只说「正在按新设置重新排版」（与上限无关）", () => {
    render(
      <ExactPreviewStatus
        current={shot(2)}
        busy
        pageLimit={0}
        headingSerif={false}
        active
        onOpenInNewTab={vi.fn()}
      />,
    );
    expect(screen.getByText(t("exact.status.busy"))).toBeInTheDocument();
  });
});
