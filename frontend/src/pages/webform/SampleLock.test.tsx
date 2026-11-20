// SPDX-License-Identifier: Apache-2.0
/**
 * 体验示例数据集下，填表入口必须灰掉并写明原因（台账第 11 条 A 部分）。
 *
 * 断言两件事：`sampleLocked` 时按钮 disabled、旁边有那条说明；不锁时按钮回到可用态
 * （主数据/导入数据集的行为不能被这次改动带走）。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { WebFormPreview } from "../../types";
import { PreviewCard } from "./PreviewCard";
import { Workbar } from "./Workbar";

const HINT = t("webFormPage.sampleLocked.hint");

function preview(): WebFormPreview {
  return {
    snapshot_id: "s1",
    page: { url: "https://x/apply", title: "网申", control_count: 1 },
    items: [
      {
        index: 0,
        field: "name",
        field_label: "姓名",
        value: "张三",
        control_label: "姓名",
        control_type: "text",
        status: "ready",
        source: "rule",
        current_value: "",
        options: [],
        note: "",
      },
    ],
    missing_data: [],
    unrecognized: [],
    blocked: [],
    default_indexes: [0],
    learning: { candidates: [] },
  };
}

function renderWorkbar(sampleLocked: boolean) {
  return render(
    <Workbar
      targetUrl=""
      onChangeTargetUrl={vi.fn()}
      urlHistory={[]}
      onDeleteHistory={vi.fn()}
      busy={null}
      running={false}
      sessionActive={false}
      liveRunning={false}
      browserLoading={false}
      browserHasData={false}
      browserState="stopped"
      onStart={vi.fn()}
      onStop={vi.fn()}
      onOpenUrl={vi.fn()}
      onOpenBrowserSettings={vi.fn()}
      onRefreshStatus={vi.fn()}
      onExportDiagnostics={vi.fn()}
      onEndSession={vi.fn()}
      sampleLocked={sampleLocked}
    />,
  );
}

function renderPreview(sampleLocked: boolean) {
  return render(
    <PreviewCard
      preview={preview()}
      selected={new Set([0])}
      values={{}}
      aiSuggestions={[]}
      busy={null}
      running
      onSelectAiSuggestions={vi.fn()}
      onFill={vi.fn()}
      onToggle={vi.fn()}
      onValueChange={vi.fn()}
      sampleLocked={sampleLocked}
    />,
  );
}

// 项目未开启 vitest globals，自动清理不会生效，必须显式注册。
afterEach(cleanup);

describe("体验示例数据集的填表守卫", () => {
  it("示例数据集下「开启专用浏览器」禁用，并给出与后端 409 同一条说明", () => {
    renderWorkbar(true);

    expect(
      screen.getByRole("button", { name: t("webFormPage.browserCard.startAria") }),
    ).toBeDisabled();
    expect(screen.getByText(HINT)).toBeInTheDocument();
  });

  it("非示例数据集下「开启专用浏览器」照常可用，也没有那条说明", () => {
    renderWorkbar(false);

    expect(
      screen.getByRole("button", { name: t("webFormPage.browserCard.startAria") }),
    ).toBeEnabled();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it("示例数据集下「填充到页面」禁用并说明原因", () => {
    renderPreview(true);

    expect(screen.getByRole("button", { name: t("webFormPage.previewCard.fill") })).toBeDisabled();
    expect(screen.getByText(HINT)).toBeInTheDocument();
  });

  it("非示例数据集下「填充到页面」照常可用", () => {
    renderPreview(false);

    expect(screen.getByRole("button", { name: t("webFormPage.previewCard.fill") })).toBeEnabled();
  });
});
