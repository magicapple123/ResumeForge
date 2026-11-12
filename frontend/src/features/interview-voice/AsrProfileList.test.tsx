// SPDX-License-Identifier: Apache-2.0
/**
 * 语音配置列表/卡片：元数据、使用（禁用规则）、测试连接、⋮ 菜单、删除二次确认、键盘可达。
 *
 * 组件只收 props（不直接取数），所以这里不需要 mock 接口：动作都落在传入的回调上，
 * 断言"点了哪一条、传了哪个对象的回调"就够。
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App as AntdApp } from "antd";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import AsrProfileList from "./AsrProfileList";
import { buttonByLabel, buttonsByLabel, makeAsrProfile } from "../../test/asrTestHelpers";

const ACTIVE = makeAsrProfile({ id: "a_active", name: "生效中的 Groq" });
const SPARE = makeAsrProfile({ id: "a_spare", name: "备用 OpenAI", preset_id: "openai" });
const INCOMPLETE = makeAsrProfile({
  id: "a_incomplete",
  name: "缺 Key",
  has_key: false,
  configured: false,
});

type Props = ComponentProps<typeof AsrProfileList>;

function renderList(overrides: Partial<Props> = {}) {
  const handlers = {
    onUse: vi.fn(),
    onTest: vi.fn(),
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onClearKey: vi.fn(),
    onDelete: vi.fn(),
  };
  const props: Props = {
    profiles: [ACTIVE, SPARE, INCOMPLETE],
    activeId: ACTIVE.id,
    busyId: null,
    testingId: null,
    testResults: {},
    ...handlers,
    ...overrides,
  };
  render(
    <AntdApp>
      <AsrProfileList {...props} />
    </AntdApp>,
  );
  return handlers;
}

function useButton(label: string): HTMLElement {
  return buttonByLabel(label);
}

describe("AsrProfileList", () => {
  it("每张卡显示名称、主机、模型、协议与厂商标签", () => {
    renderList();

    expect(screen.getByText(ACTIVE.name)).toBeInTheDocument();
    expect(screen.getByText(SPARE.name)).toBeInTheDocument();
    // ACTIVE 与 SPARE 同属 Groq：同一个主机名会出现两次。
    expect(screen.getAllByText(/api\.groq\.com/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("whisper-large-v3").length).toBeGreaterThan(0);
    expect(screen.getByText(t("voiceInput.settings.badge.active"))).toBeInTheDocument();
  });

  it("生效中的那条显示「使用中」且按钮禁用；未生效的可以点「使用」", () => {
    const handlers = renderList();

    expect(useButton(t("voiceInput.settings.profile.using"))).toBeDisabled();
    const spareUse = buttonsByLabel(t("voiceInput.settings.profile.use"))[0];
    expect(spareUse).toBeEnabled();
    fireEvent.click(spareUse);
    expect(handlers.onUse).toHaveBeenCalledWith(SPARE);
  });

  it("不完整的配置「使用」禁用，并说明缺什么", async () => {
    renderList();

    const incompleteUse = buttonsByLabel(t("voiceInput.settings.profile.use"));
    // 三张卡里只有 SPARE 可用；INCOMPLETE 的那颗是禁用的最后一颗。
    const disabled = incompleteUse[incompleteUse.length - 1];
    expect(disabled).toBeDisabled();

    fireEvent.mouseEnter(disabled.parentElement as HTMLElement);
    expect(
      await screen.findByText(
        t("voiceInput.settings.profile.incomplete", {
          fields: t("voiceInput.settings.profile.missing.key"),
        }),
      ),
    ).toBeInTheDocument();
  });

  it("测试连接：点哪张测哪张，结果只显示在那一张卡里", () => {
    const handlers = renderList({
      testResults: { [ACTIVE.id]: { ok: true, latency_ms: 120, message: "ok" } },
    });

    expect(screen.getByText(t("voiceInput.settings.testOk", { ms: 120 }))).toBeInTheDocument();
    const testButtons = buttonsByLabel(t("voiceInput.settings.test"));
    fireEvent.click(testButtons[1]);
    expect(handlers.onTest).toHaveBeenCalledWith(SPARE);
  });

  /** 打开某张卡的 ⋮ 菜单（菜单弹层里点文字；图标自带 aria-label 会污染可访问名）。 */
  async function openRowMenu(profileName: string): Promise<void> {
    fireEvent.click(
      screen.getByRole("button", {
        name: t("voiceInput.settings.profile.more", { name: profileName }),
      }),
    );
  }

  it("⋮ → 编辑", async () => {
    const handlers = renderList();
    await openRowMenu(ACTIVE.name);
    fireEvent.click(await screen.findByText(t("voiceInput.settings.profile.edit")));
    expect(handlers.onEdit).toHaveBeenCalledWith(ACTIVE);
  });

  it("⋮ → 复制", async () => {
    const handlers = renderList();
    await openRowMenu(ACTIVE.name);
    fireEvent.click(await screen.findByText(t("voiceInput.settings.profile.duplicate")));
    expect(handlers.onDuplicate).toHaveBeenCalledWith(ACTIVE);
  });

  it("⋮ → 清除已保存的 Key", async () => {
    const handlers = renderList();
    await openRowMenu(ACTIVE.name);
    fireEvent.click(await screen.findByText(t("voiceInput.settings.key.clear")));
    expect(handlers.onClearKey).toHaveBeenCalledWith(ACTIVE);
  });

  it("⋮ → 删除：二次确认写清回落后果", async () => {
    const handlers = renderList();
    await openRowMenu(ACTIVE.name);
    fireEvent.click(await screen.findByText(t("voiceInput.settings.profile.delete")));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(t("voiceInput.settings.profile.deleteConfirm")),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /删\s*除/ }));
    await waitFor(() => expect(handlers.onDelete).toHaveBeenCalledWith(ACTIVE));
  });

  it("卡本体可点击、可键盘打开编辑", () => {
    const handlers = renderList();

    const card = screen.getByRole("button", {
      name: t("voiceInput.settings.profile.editAria", { name: ACTIVE.name }),
    });
    fireEvent.click(card);
    expect(handlers.onEdit).toHaveBeenCalledWith(ACTIVE);

    fireEvent.keyDown(card, { key: "Enter" });
    expect(handlers.onEdit).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(card, { key: " " });
    expect(handlers.onEdit).toHaveBeenCalledTimes(3);
  });
});
