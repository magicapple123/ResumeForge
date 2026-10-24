// SPDX-License-Identifier: Apache-2.0
import { App as AntdApp } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import FontCoverageCard from "./FontCoverageCard";

/** 用转义写字符，测试源码本身不出现中文（cjkRatchet tests 口径基线为 0）。 */
const GLYPH = "\u5b57";

function renderCard(coverage: Parameters<typeof FontCoverageCard>[0]["coverage"]) {
  return render(
    <AntdApp>
      <FontCoverageCard coverage={coverage} />
    </AntdApp>,
  );
}

afterEach(() => cleanup());

describe("D08 字体覆盖卡", () => {
  it("未检查（null）时不显示通过，只说明未检查", () => {
    renderCard(null);
    expect(screen.getByText(t("preflight.font.notChecked"))).toBeInTheDocument();
    expect(screen.queryByText(t("preflight.font.missing", { count: 0 }))).toBeNull();
  });

  it("没有中文字体时说明无法检查缺字", () => {
    renderCard({
      checked: false,
      font: null,
      bold_available: false,
      missing: { regular: [], bold: [] },
      truncated: false,
    });
    expect(screen.getByText(t("preflight.font.noFont"))).toBeInTheDocument();
  });

  it("列出缺字与粗体回退；截断时如实说明", () => {
    renderCard({
      checked: true,
      font: "Noto Sans CJK",
      bold_available: false,
      missing: { regular: [GLYPH], bold: [] },
      truncated: true,
    });
    expect(screen.getByText(t("preflight.font.missing", { count: 1 }))).toBeInTheDocument();
    expect(screen.getByText(t("preflight.font.missingList", { chars: GLYPH }))).toBeInTheDocument();
    expect(screen.getByText(t("preflight.font.boldFallback"))).toBeInTheDocument();
    expect(screen.getByText(t("preflight.font.truncated"))).toBeInTheDocument();
    expect(screen.getByText(t("preflight.font.hint"))).toBeInTheDocument();
  });
});
