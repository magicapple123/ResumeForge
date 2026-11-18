// SPDX-License-Identifier: Apache-2.0
/**
 * DF-10：新建自定义字段必须先起名（可留空），取消不产生任何改动。
 *
 * 守三件事：
 * 1. 填了名字 → `label` 一起写入，`key` 仍是 `custom:…`（判据不许改）；
 * 2. 名字留空 → 允许创建，展示层显示「未命名字段」（不是 `custom:` 内部键）；
 * 3. 取消 → 不创建、不产生空历史点。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { t } from "../../../i18n";
import type { ResumeDocument } from "../../../types/resumeDocument";
import { makeDocument } from "../document/documentFixtures";
import AddFieldMenu from "./AddFieldMenu";

afterEach(cleanup);

function renderMenu(document: ResumeDocument = makeDocument()) {
  const onChange = vi.fn();
  const onSelectPath = vi.fn();
  const onNotice = vi.fn();
  render(
    <AddFieldMenu
      document={document}
      sectionKey="education"
      entryId="ob_entry001"
      placement="title"
      label={t("document.addField.action")}
      onChange={onChange}
      onSelectPath={onSelectPath}
      onNotice={onNotice}
    />,
  );
  return { onChange, onSelectPath, onNotice };
}

/** 打开菜单 → 点「自定义字段」→ 等命名弹框出现。 */
async function openNamingModal() {
  fireEvent.click(screen.getByRole("button", { name: t("document.addField.action") }));
  const custom = await screen.findByRole("menuitem", { name: t("document.addField.custom") });
  fireEvent.click(custom);
  return await screen.findByLabelText(t("document.addField.customLabel"));
}

/** 取最后一次 onChange 里 education 第一条目的最后一个字段。 */
function lastAddedField(onChange: ReturnType<typeof vi.fn>) {
  const calls = onChange.mock.calls;
  const next = calls[calls.length - 1][0] as ResumeDocument;
  const items = next.sections.find((section) => section.key === "education")!.entries[0].items;
  return items[items.length - 1];
}

describe("AddFieldMenu · 自定义字段命名（DF-10）", () => {
  it("填名字后创建：label 写入，key 仍是 custom: 前缀", async () => {
    const { onChange, onSelectPath } = renderMenu();
    const input = await openNamingModal();
    fireEvent.change(input, { target: { value: "证书编号" } });
    fireEvent.click(screen.getByRole("button", { name: t("document.addField.customSubmit") }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const field = lastAddedField(onChange);
    expect(field).toMatchObject({ kind: "field", label: "证书编号" });
    expect(field?.kind === "field" && field.label).not.toContain("custom:");
    expect(field?.kind === "field" && field.key.startsWith("custom:")).toBe(true);
    expect(onSelectPath).toHaveBeenCalledTimes(1);
  });

  it("名字留空也允许创建（展示层兜底为「未命名字段」）", async () => {
    const { onChange } = renderMenu();
    await openNamingModal();
    fireEvent.click(screen.getByRole("button", { name: t("document.addField.customSubmit") }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const field = lastAddedField(onChange);
    expect(field).toMatchObject({ kind: "field", label: "" });
  });

  it("取消弹框：不创建字段、不调 onChange", async () => {
    const { onChange, onNotice } = renderMenu();
    await openNamingModal();
    fireEvent.change(screen.getByLabelText(t("document.addField.customLabel")), {
      target: { value: "证书编号" },
    });
    // antd 会在两个汉字的按钮文案里插一个空格（"取 消"），按文字匹配要容忍它。
    fireEvent.click(screen.getByRole("button", { name: /取\s*消/ }));

    // jsdom 里 antd 的退场动画不会走完（没有 transitionend），弹窗 DOM 会留在 portal 里；
    // 关闭语义本身由 `FormModal.test.tsx` 守，这里只守"取消不产生改动"这条业务后果。
    await waitFor(() => expect(onChange).not.toHaveBeenCalled());
    expect(onNotice).not.toHaveBeenCalled();
  });
});
