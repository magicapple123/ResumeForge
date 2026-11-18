// SPDX-License-Identifier: Apache-2.0
/**
 * DF-6 / DF-10 的**界面守卫**：chip 的无障碍名与可见文字都不许露出源串或内部键。
 *
 * 这两条是"散点兜底"最容易漏的地方——`fieldDisplayName` / `displayText` 各自只负责一段，
 * 真正给读屏念的是 `aria-label` 的拼接结果，所以用真实渲染再断言一次。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { t } from "../../../i18n";
import { entry, fieldItem, makeDocument, section } from "../document/documentFixtures";
import DocumentEditor from "./DocumentEditor";

afterEach(cleanup);

function renderEditor(document = makeDocument()) {
  const view = render(
    <DocumentEditor document={document} onChange={vi.fn()} onSelectPath={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("tab", { name: t("editor.section.education") }));
  return view;
}

describe("chip 展示（DF-6 / DF-10）", () => {
  it("空名自定义字段 + 带标记的值：读屏与可见文字都不含 custom: / {@", () => {
    const document = makeDocument({
      sections: [
        section({
          entries: [
            entry({
              id: "ob_entry001",
              items: [
                fieldItem({
                  id: "ob_item0001",
                  key: "custom:ob_jhdfjembnz3u",
                  label: "",
                  value: "{@color=#c0392b}个人项目{@}",
                  placement: "title",
                }),
              ],
            }),
          ],
        }),
      ],
    });
    const { container } = renderEditor(document);

    const chip = container.querySelector(
      '.document-chip[data-document-path="education.ob_entry001.ob_item0001"]',
    );
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute("aria-label")).toBe(`${t("document.field.unnamed")}\uFF1A个人项目`);
    expect(container.textContent).not.toContain("{@");
    expect(container.textContent).not.toContain("custom:");
  });

  it("命名后的自定义字段显示用户名字", () => {
    const document = makeDocument({
      sections: [
        section({
          entries: [
            entry({
              id: "ob_entry001",
              items: [
                fieldItem({
                  id: "ob_item0001",
                  key: "custom:ob_jhdfjembnz3u",
                  label: "证书编号",
                  value: "CET-6",
                  placement: "title",
                }),
              ],
            }),
          ],
        }),
      ],
    });
    const { container } = renderEditor(document);
    const chip = container.querySelector(
      '.document-chip[data-document-path="education.ob_entry001.ob_item0001"]',
    );
    expect(chip?.getAttribute("aria-label")).toBe("证书编号\uFF1ACET-6");
    expect(container.textContent).not.toContain("custom:");
  });

  it("页眉 chip 的值同样剥离行内标记（DF-6 的第七处出口）", () => {
    const document = makeDocument();
    document.header.items.push({
      kind: "field",
      id: "ob_head0003",
      key: "job_intent",
      label: "",
      value: "{@color=#c0392b}后端开发{@}工程师（校招）",
      placement: "subtitle",
      format: "text",
    });

    // 页眉 chip 在「基本信息」页签（默认页签），不能先切到教育页签。
    const { container } = render(
      <DocumentEditor document={document} onChange={vi.fn()} onSelectPath={vi.fn()} />,
    );

    const chip = Array.from(container.querySelectorAll(".document-chip")).find((node) =>
      (node.getAttribute("aria-label") ?? "").includes("后端开发"),
    );
    expect(chip).not.toBeUndefined();
    expect(chip?.getAttribute("aria-label")).toContain("后端开发工程师（校招）");
    expect(chip?.getAttribute("aria-label")).not.toContain("{@");
    expect(container.textContent).not.toContain("{@");
  });
});
