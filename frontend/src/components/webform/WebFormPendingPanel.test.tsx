/**
 * 「页面还要求这些」面板的出口断言。
 *
 * 三个分区各自该有一条出口：资料里没有 → 去「我的资料」补上；需要你自己动手 /
 * 没认出来 → 指向「智能逐项填表」的「换个资料…」（那是浏览器面板里永远在的
 * 出口，批量预览这里不复刻——见 LiveExitHint 的注释）。全空时如实说没负担。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { WebFormPendingItem } from "../../types";
import WebFormPendingPanel from "./WebFormPendingPanel";

function item(index: number, label: string): WebFormPendingItem {
  return { index, label, required: false, field: "", field_label: "" };
}

function renderPanel(props: {
  missingData?: WebFormPendingItem[];
  unrecognized?: WebFormPendingItem[];
  blocked?: WebFormPendingItem[];
}) {
  return render(
    <MemoryRouter>
      <WebFormPendingPanel
        missingData={props.missingData ?? []}
        unrecognized={props.unrecognized ?? []}
        blocked={props.blocked ?? []}
      />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("WebFormPendingPanel", () => {
  it("每一块都有自己该走的出口", () => {
    renderPanel({
      missingData: [item(0, "学号")],
      blocked: [item(1, "验证码")],
      unrecognized: [item(2, "导师姓名")],
    });

    // 资料里没有 → 去补资料。
    expect(screen.getByText("去我的资料补上")).toBeTruthy();
    // 需要你自己动手 → 指向「换个资料…」。
    expect(screen.getAllByText(/换个资料/).length).toBe(1);
    // 没认出来 → 默认收起（antd Collapse 懒渲染），展开后同样有「换个资料…」。
    fireEvent.click(screen.getByText(/没认出来/));
    expect(screen.getAllByText(/换个资料/).length).toBe(2);
  });

  it("blocked 与没认出来的分区都带「换个资料…」提示", () => {
    renderPanel({ blocked: [item(0, "简历附件")] });
    expect(screen.getAllByText(/换个资料/).length).toBe(1);

    cleanup();

    renderPanel({ unrecognized: [item(0, "研究方向")] });
    // 「没认出来」默认收起，展开后提示才可见。
    fireEvent.click(screen.getByText(/没认出来/));
    expect(screen.getAllByText(/换个资料/).length).toBe(1);
  });

  it("没有待处理项时如实说这一页没有手动负担", () => {
    renderPanel({});
    expect(screen.getByText("这一页没有需要你手动处理的项")).toBeTruthy();
  });
});
