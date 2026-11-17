// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { t } from "../../i18n";
import { analyticsDashboard } from "../../pages/analyticsTestFixtures";
import { dashboardToCsv } from "./exportCsv";

describe("dashboard CSV export (T13)", () => {
  it("starts with a UTF-8 BOM so Excel does not garble Chinese headers", () => {
    const csv = dashboardToCsv(analyticsDashboard());
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("has the three-column header and keeps raw numbers", () => {
    const csv = dashboardToCsv(analyticsDashboard());
    const lines = csv.split("\r\n");
    // 第一行带 BOM（去掉后再比表头，BOM 由上面的用例单独守）。
    expect(lines[0].replace(/^\uFEFF/u, "")).toBe(
      [
        t("analyticsPage.export.section"),
        t("analyticsPage.export.metric"),
        t("analyticsPage.export.value"),
      ].join(","),
    );
    // 投递总数是 7，不能变成 7.0 或空。
    expect(csv).toContain(`,${t("analyticsPage.export.total")},7`);
  });

  it("quotes labels that contain a comma (otherwise columns shift)", () => {
    const csv = dashboardToCsv(
      analyticsDashboard({ funnel: [{ status: "applied", label: "applied,internal", count: 3 }] }),
    );
    expect(csv).toContain('"applied,internal"');
  });
});
