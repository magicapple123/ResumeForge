// SPDX-License-Identifier: Apache-2.0
/**
 * 纸张上方两条提示的行为契约。
 *
 * 重点守的是 2026-10-29 那条用户反馈：精确模式下同屏出现**两个**页数提醒
 * （「约需 5 页」+「约需 6 页」）——一条来自草稿画布的浏览器分页，一条来自服务端 PDF。
 * 现在按口径只留后者，这个文件把"草稿有 / 精确没有"钉住。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../i18n";
import PreviewAlerts from "./PreviewAlerts";

const OVERFLOW_TITLE = t("exact.overflow.title", { needed: 6, limit: 3 });

function renderAlerts(props: Partial<Parameters<typeof PreviewAlerts>[0]> = {}) {
  return render(
    <PreviewAlerts
      warnings={[]}
      overflow
      overflowClipped={false}
      pagesNeeded={6}
      pageCount={3}
      overflowAmountText="1.4 pages"
      {...props}
    />,
  );
}

afterEach(cleanup);

describe("预览提示条（草稿 / 精确两种口径）", () => {
  it("草稿口径：溢出时给出一条页数提醒", () => {
    renderAlerts({ mode: "draft" });
    expect(screen.getByText(OVERFLOW_TITLE)).toBeInTheDocument();
    expect(document.querySelectorAll(".resume-preview-overflow")).toHaveLength(1);
  });

  it("精确口径：草稿侧的页数提醒整条不渲染（页数由 ExactPreviewAlerts 负责）", () => {
    renderAlerts({ mode: "exact" });
    expect(screen.queryByText(OVERFLOW_TITLE)).toBeNull();
    expect(document.querySelector(".resume-preview-overflow")).toBeNull();
    // 什么都不该剩下：不渲染一个没有内容的空盒子。
    expect(document.querySelector(".resume-preview-alerts")).toBeNull();
  });

  it("精确口径下渲染警告照旧（它说的是字体缺字这类事，与页数无关）", () => {
    // 警告文案本身用 ASCII：这一行是**断言**，中文断言会顶到 cjkRatchet 的 tests 基线
    // （新文件没有额度），而这条用例要验的是"警告还在"，与文案是不是中文无关。
    renderAlerts({ mode: "exact", warnings: ["Missing glyph: X"] });
    expect(screen.getByText("Missing glyph: X")).toBeInTheDocument();
    expect(screen.queryByText(OVERFLOW_TITLE)).toBeNull();
  });
});
