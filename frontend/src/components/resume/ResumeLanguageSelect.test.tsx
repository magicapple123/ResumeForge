// SPDX-License-Identifier: Apache-2.0
/**
 * 简历语言下拉（F-18）。
 *
 * 这个控件小，但它管的是一件容易被静默搞坏的事：**语言到底存到了哪个值**。
 * 所以这里钉住四件事：
 *
 * 1. 两种值都渲染得出来（`zh-CN` → 中文、`en-US` → English），不是"选中了但框里是空的"；
 * 2. 选英文时 `onChange` 收到的是 `"en-US"`，不是显示文案「English」——
 *    把标签当值发出去，后端会把它当成未知语言悄悄回落成中文；
 * 3. `disabled` 真的挡住交互（渲染中 / 只读时不该还能改）；
 * 4. 无障碍名就是 `t("resume.language.label")`：视觉上的分组标签由宿主渲染，
 *    读屏软件在本控件上只能靠这个 `aria-label`。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ResumeLanguage } from "../../types";
import ResumeLanguageSelect from "./ResumeLanguageSelect";

function renderSelect(value: ResumeLanguage, disabled = false) {
  const onChange = vi.fn();
  const view = render(
    <AntdApp>
      <ResumeLanguageSelect value={value} onChange={onChange} disabled={disabled} />
    </AntdApp>,
  );
  return { onChange, view };
}

/** 打开下拉（antd 的 Select 由 mousedown 展开），返回触发框所在的根节点。 */
async function openDropdown(): Promise<{ combobox: HTMLElement; root: HTMLElement }> {
  const combobox = await screen.findByRole("combobox", { name: t("resume.language.label") });
  fireEvent.mouseDown(combobox);
  return { combobox, root: combobox.closest(".ant-select") as HTMLElement };
}

afterEach(() => {
  cleanup();
  // 下拉渲染在 portal 里（挂在 body 上）：不清掉会把上一个用例的选项留给下一个。
  document.body.innerHTML = "";
});

describe("ResumeLanguageSelect", () => {
  it("中文：选中态显示「中文」，无障碍名是语言标签", async () => {
    renderSelect("zh-CN");

    const combobox = await screen.findByRole("combobox", { name: t("resume.language.label") });
    const root = combobox.closest(".ant-select") as HTMLElement;
    expect(root).not.toBeNull();
    // 选中态显示的是语言包里的词，不是 key 本身。
    expect(root.textContent).toContain(t("resume.language.zh-CN"));
    expect(root.textContent).toContain("中文");
    // 无障碍名与语言包同源：改名只改语言包，测试跟着一起变。
    expect(combobox).toHaveAttribute("aria-label", t("resume.language.label"));
    expect(combobox).toHaveAttribute("aria-label", "简历语言");
  });

  it("英文：选中态显示 English，不是 key 也不是空白", async () => {
    renderSelect("en-US");

    const { root } = await openDropdown();
    // 触发框里那一份（选项列表此时也有一份同名的 English）。
    expect(root.textContent).toContain(t("resume.language.en-US"));
    expect(root.textContent).toContain("English");
  });

  it("下拉里两种语言都在，按中文在前排列", async () => {
    renderSelect("zh-CN");

    await openDropdown();

    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent(t("resume.language.zh-CN"));
    expect(options[1]).toHaveTextContent(t("resume.language.en-US"));
  });

  it("选 English 时回调收到语言值 en-US，而不是显示文案", async () => {
    const { onChange } = renderSelect("zh-CN");

    await openDropdown();
    fireEvent.click(await screen.findByTitle(t("resume.language.en-US")));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("en-US");
  });

  it("disabled 时打不开下拉、也发不出 onChange", async () => {
    const { onChange } = renderSelect("zh-CN", true);

    const combobox = await screen.findByRole("combobox", { name: t("resume.language.label") });
    expect(combobox).toBeDisabled();

    fireEvent.mouseDown(combobox);
    expect(screen.queryByRole("option")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
