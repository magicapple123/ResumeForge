// SPDX-License-Identifier: Apache-2.0
/**
 * I-14：chip 被省略号截断的值必须能"悬停 / 聚焦看全文"，且**只能有一个气泡**。
 *
 * 用真实 `DocumentEditor` 渲染（与 `DocumentEditor.chipLabels.test.tsx` 同一套夹具）：
 * 单独测 `ItemChip` 要自己拼 drag / chipMenu / factSource 四个 context，测出来的东西
 * 反而可能不是线上那一份。
 *
 * jsdom 里量不到"省略号是否真的出现了"（没有布局），所以钉的是提示本身：
 * 值节点不再挂原生 `title`、hover 与 focus 都能拿到全文、宽度上限 320px。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { entry, fieldItem, makeDocument, section } from "../document/documentFixtures";
import DocumentEditor from "./DocumentEditor";

const LONG_VALUE = "机器学习；深度学习基础；自然语言处理；大模型应用实践";

afterEach(cleanup);

function renderChip(value = LONG_VALUE) {
  const document = makeDocument({
    sections: [
      section({
        entries: [
          entry({
            id: "ob_entry001",
            items: [
              fieldItem({
                id: "ob_item0001",
                key: "custom:ob_skill0001",
                label: "",
                value,
                placement: "title",
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const view = render(
    <DocumentEditor document={document} onChange={vi.fn()} onSelectPath={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("tab", { name: t("editor.section.education") }));
  const chip = view.container.querySelector(
    '[data-document-path="education.ob_entry001.ob_item0001"]',
  ) as HTMLElement;
  const valueSpan = chip.querySelector(".document-chip-value") as HTMLElement;
  return { chip, valueSpan };
}

/** 等气泡出现并返回它的内容节点（与可见性无关，避免 motion 抖动带来的假失败）。 */
async function waitForTip(): Promise<HTMLElement> {
  return waitFor(() => {
    const tip = document.querySelector(".ant-tooltip-container");
    if (!tip || tip.textContent !== LONG_VALUE) throw new Error("tooltip 还没出现");
    return tip as HTMLElement;
  });
}

describe("chip 的悬停提示（I-14）", () => {
  it("值节点不再挂原生 title：两套气泡会叠在一起", () => {
    const { valueSpan } = renderChip();
    expect(valueSpan.getAttribute("title")).toBeNull();
  });

  it("hover 后出现 antd tooltip：全文、宽度上限 320px、只有一个气泡", async () => {
    const { valueSpan } = renderChip();
    fireEvent.mouseEnter(valueSpan);
    const tip = await waitForTip();
    expect(tip.textContent).toBe(LONG_VALUE);
    const root = document.querySelector(".ant-tooltip") as HTMLElement;
    expect(root.style.maxWidth).toBe("320px");
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
  });

  it("键盘可达：聚焦 chip 按钮也能看到全文", async () => {
    const { chip } = renderChip();
    const button = chip.querySelector(".document-chip-main") as HTMLElement;
    // 真 focus() 才会派发 React 认的 focusin（fireEvent.focus 只派发不冒泡的 focus）。
    act(() => button.focus());
    expect(document.activeElement).toBe(button);
    const tip = await waitForTip();
    expect(tip.textContent).toBe(LONG_VALUE);
  });

  it("空值不弹气泡（title 为空时 Tooltip 不打开）", async () => {
    const { valueSpan } = renderChip("");
    fireEvent.mouseEnter(valueSpan);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector(".ant-tooltip-container")).toBeNull();
  });
});
