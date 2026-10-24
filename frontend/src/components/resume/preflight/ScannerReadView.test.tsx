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
  it("逐页展示抽取文本；缺失 token 标红、顺序差异标提示且图例可见", () => {
    const { container } = renderScanner({
      pages: [{ page: 1, text: "alpha beta gamma" }],
      diffs: [
        { kind: "missing", token: "beta", page: 1, expected_index: 1 },
        { kind: "out_of_order", token: "gamma", page: 1, expected_index: 2 },
      ],
    });
    expect(screen.getByText(t("preflight.scanner.page", { page: 1 }))).toBeInTheDocument();
    expect(screen.getByText(t("preflight.scanner.legend.missing"))).toBeInTheDocument();
    expect(screen.getByText(t("preflight.scanner.legend.outOfOrder"))).toBeInTheDocument();
    const missing = container.querySelector('[data-proview-diff="missing"]');
    const order = container.querySelector('[data-proview-diff="out_of_order"]');
    expect(missing?.textContent).toBe("beta");
    expect(order?.textContent).toBe("gamma");
    // 双栏顺序差异是"已知近似"，视图必须给出解释而不是当错误。
    expect(screen.getByText(t("preflight.scanner.hint"))).toBeInTheDocument();
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
