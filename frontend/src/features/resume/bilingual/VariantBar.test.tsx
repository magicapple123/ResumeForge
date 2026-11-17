// SPDX-License-Identifier: Apache-2.0
/**
 * 语言版本切换条（T19）：切换项**只列已有版本**，缺版时用虚线按钮创建。
 *
 * 旧形态把「+ 未创建」当成 Segmented 的第三项，选项数（3）永远不等于版本数（1 或 2）：
 * 一眼看不出"哪个已有、哪个还没有"，而"点击一个选项去创建"也不是选择器的语义。
 */
import { App as AntdApp } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bt } from "./i18n";
import VariantBar from "./VariantBar";
import type { LanguageVariant } from "./types";

function variant(language: "zh-CN" | "en-US", id = 1): LanguageVariant {
  return {
    id,
    resume_id: 5,
    name: language === "en-US" ? "English version" : "中文版",
    language,
    variant_group_id: null,
    created_at: "2026-10-01T00:00:00Z",
  };
}

const CREATE_EN = bt("bilingual.variant.createOption", { language: bt("bilingual.variant.en") });

function renderBar(props: Partial<Parameters<typeof VariantBar>[0]> = {}) {
  const onCreate = props.onCreate ?? vi.fn();
  render(
    <AntdApp>
      <VariantBar
        variants={[variant("zh-CN")]}
        current="zh-CN"
        onSwitch={vi.fn()}
        onCreate={onCreate}
        {...props}
      />
    </AntdApp>,
  );
  return { onCreate };
}

afterEach(cleanup);

describe("VariantBar", () => {
  it("只有一个版本：切换项就一项，没有「第三项」占位", () => {
    renderBar();
    expect(screen.getByText(bt("bilingual.variant.zh"))).toBeInTheDocument();
    // 缺的那个语言**不能**出现在切换器里（旧形态把它做成 Segmented 的第三项）。
    // 语言包里的旧文案（「+ 未创建」）已整体删除，这条断言证明切换器不再引用它。
    expect(screen.queryByText(bt("bilingual.variant.en"))).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(1);
  });

  it("缺英文版：一颗虚线按钮，文案带语言名", () => {
    renderBar();
    const create = screen.getByRole("button", { name: CREATE_EN });
    // `type="dashed"` 是这条可发现性的一部分：它是"创建动作"，和版本选项长得不一样。
    expect(create.className).toContain("ant-btn-dashed");
    expect(CREATE_EN).toContain(bt("bilingual.variant.en"));
  });

  it("点虚线按钮创建缺的那一份（语言由缺失项决定）", () => {
    const { onCreate } = renderBar();
    screen.getByRole("button", { name: CREATE_EN }).click();
    expect(onCreate).toHaveBeenCalledWith("en-US");
  });

  it("两份都在：不再出现创建按钮", () => {
    renderBar({ variants: [variant("zh-CN"), variant("en-US", 2)] });
    expect(screen.queryByRole("button", { name: CREATE_EN })).toBeNull();
  });

  it("busy 期间按钮禁用并换成阶段文案", () => {
    renderBar({ busy: true, busyLabel: bt("bilingual.variant.translating") });
    const create = screen.getByRole("button", { name: bt("bilingual.variant.translating") });
    expect(create).toBeDisabled();
  });

  it("只读模式：按钮仍在（告诉用户这里能创建），但不可点", () => {
    renderBar({ disabled: true });
    expect(screen.getByRole("button", { name: CREATE_EN })).toBeDisabled();
  });
});
