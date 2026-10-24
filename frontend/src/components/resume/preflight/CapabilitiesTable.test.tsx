// SPDX-License-Identifier: Apache-2.0
import { App as AntdApp } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import CapabilitiesTable from "./CapabilitiesTable";

function renderTable(capabilities: Record<string, unknown>) {
  return render(
    <AntdApp>
      <CapabilitiesTable capabilities={capabilities} />
    </AntdApp>,
  );
}

afterEach(() => cleanup());

describe("格式能力矩阵（W11 消费 W05）", () => {
  it("扁平键 → 能力行 × 格式列，等级用统一词条", () => {
    renderTable({ "pdf:italic": "approx", "docx:italic": "supported" });
    expect(screen.getAllByText(t("preflight.capabilities.capability")).length).toBeGreaterThan(0);
    // antd Table 的表头在测量行里会出现两份，按"至少一处"断言。
    expect(screen.getAllByText(t("preflight.format.pdf")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t("preflight.format.docx")).length).toBeGreaterThan(0);
    expect(screen.getByText(t("preflight.capability.italic"))).toBeInTheDocument();
    expect(screen.getByText(t("preflight.capability.approx"))).toBeInTheDocument();
    expect(screen.getByText(t("preflight.capability.supported"))).toBeInTheDocument();
  });

  it("嵌套形状也兼容；未知等级按要求显示为未知", () => {
    renderTable({ pdf: { link_clickable: "unsupported", weird: "maybe" } });
    expect(screen.getByText(t("preflight.capability.linkClickable"))).toBeInTheDocument();
    expect(screen.getByText(t("preflight.capability.unsupported"))).toBeInTheDocument();
    expect(screen.getByText("weird")).toBeInTheDocument();
    expect(screen.getAllByText(t("preflight.capability.unknown")).length).toBeGreaterThan(0);
  });

  it("没有能力矩阵时显示空态，不显示空表", () => {
    renderTable({});
    expect(screen.getByText(t("preflight.capabilities.empty"))).toBeInTheDocument();
  });
});
