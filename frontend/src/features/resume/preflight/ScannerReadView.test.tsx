// SPDX-License-Identifier: Apache-2.0
import { App as AntdApp } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import ScannerReadView from "./ScannerReadView";

function renderScanner(props: Partial<Parameters<typeof ScannerReadView>[0]> = {}) {
  return render(
    <AntdApp>
      <ScannerReadView {...props} />
    </AntdApp>,
  );
}

afterEach(() => cleanup());

describe("D11 机器读正文视图", () => {
  it("逐页展示抽取文本；只有区间内那段带底色，图例可见", () => {
    const text = "alpha beta gamma";
    const { container } = renderScanner({
      pages: [{ page: 1, text }],
      diffs: [
        { kind: "missing", token: "beta", page: 1, expected_index: 1 },
        { kind: "out_of_order", token: "gamma", page: 1, expected_index: 2 },
      ],
      // 区间由后端给出：只有 gamma（含）是顺序差异，beta 是 missing —— 产物里有同名文字
      // 也不涂（missing 没有区间）。
      highlights: [
        { page: 1, start: text.indexOf("gamma"), end: text.length, kind: "out_of_order" },
      ],
    });
    expect(screen.getByText(t("preflight.scanner.page", { page: 1 }))).toBeInTheDocument();
    expect(screen.getByText(t("preflight.scanner.legend.missing"))).toBeInTheDocument();
    expect(screen.getByText(t("preflight.scanner.legend.outOfOrder"))).toBeInTheDocument();
    // missing 不再是"涂红一段字"，只是图例/清单里的一条。
    expect(container.querySelector('[data-proview-diff="missing"]')).toBeNull();
    const order = container.querySelector('[data-proview-diff="out_of_order"]');
    expect(order?.textContent).toBe("gamma");
    // 双栏顺序差异是"已知近似"，视图必须给出解释而不是当错误。
    expect(screen.getByText(t("preflight.scanner.hint"))).toBeInTheDocument();
  });

  it("同一片段出现多次时只涂区间内那一处", () => {
    const { container } = renderScanner({
      pages: [{ page: 1, text: "与与与与甲" }],
      diffs: [{ kind: "out_of_order", token: "与", page: 1, expected_index: 0 }],
      highlights: [{ page: 1, start: 3, end: 4, kind: "out_of_order" }],
    });
    const painted = container.querySelectorAll('[data-proview-diff="out_of_order"]');
    expect(painted).toHaveLength(1);
    expect(painted[0].textContent).toBe("与");
    expect(painted[0].previousSibling?.textContent).toBe("与与与");
  });

  it("老响应没有 order_highlights：正文不涂色但不报错", () => {
    const { container } = renderScanner({
      pages: [{ page: 1, text: "alpha beta" }],
      diffs: [{ kind: "out_of_order", token: "beta", page: 1, expected_index: 1 }],
    });
    expect(container.querySelectorAll("[data-proview-diff]")).toHaveLength(0);
    expect(screen.getByText(t("preflight.scanner.legend.outOfOrder"))).toBeInTheDocument();
  });

  it("没有差异时说明抽取正文与结构化内容一致", () => {
    renderScanner({ pages: [{ page: 1, text: "alpha" }], diffs: [] });
    expect(screen.getByText(t("preflight.scanner.clean"))).toBeInTheDocument();
    expect(screen.queryByText(t("preflight.scanner.legend.missing"))).toBeNull();
  });

  it("没有机器读正文（未跑产物层）时显示空态而不是空白", () => {
    renderScanner({ pages: [], diffs: [] });
    expect(screen.getByText(t("preflight.scanner.empty"))).toBeInTheDocument();
  });
});
