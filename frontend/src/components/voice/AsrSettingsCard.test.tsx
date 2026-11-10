// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「语音转写」卡：首屏是配置列表、徽标跟随生效项、加载/错误/空态、条数上限。
 *
 * 列表/卡片的交互在 AsrProfileList.test.tsx，弹窗在 AsrProfileModal.test.tsx；这里守着
 * 编排层：数据来自 hook、出错给重试、上限时禁用新建。
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { buttonByLabel, makeAsrProfile, makeProfilesState } from "../../test/asrTestHelpers";

const apiMocks = vi.hoisted(() => ({
  getAsrProfiles: vi.fn(),
  saveAsrProfile: vi.fn(),
  deleteAsrProfile: vi.fn(),
  activateAsrProfile: vi.fn(),
  clearAsrProfileKey: vi.fn(),
  testAsrProfile: vi.fn(),
}));

vi.mock("./asrApi", () => ({
  ...apiMocks,
  MAX_ASR_PROFILES: 10,
  NEW_ASR_PROFILE_ID: "new",
  providerHostOf: (baseUrl: string) => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return "";
    }
  },
}));

import AsrSettingsCard from "./AsrSettingsCard";

function renderCard() {
  return render(
    <AntdApp>
      <AsrSettingsCard />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.getAsrProfiles.mockReset().mockResolvedValue(makeProfilesState([]));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AsrSettingsCard", () => {
  it("读取已保存配置：列表、生效中标记与「已配置」徽标", async () => {
    const active = makeAsrProfile();
    apiMocks.getAsrProfiles.mockResolvedValue(makeProfilesState([active], active.id));
    renderCard();

    expect(await screen.findByText(active.name)).toBeInTheDocument();
    expect(screen.getByText(t("voiceInput.settings.badge.configured"))).toBeInTheDocument();
    expect(screen.getByText(t("voiceInput.settings.badge.active"))).toBeInTheDocument();
  });

  it("没有任何配置：不内嵌主按钮，空态说明指向卡头的「新建配置」", async () => {
    renderCard();

    expect(
      await screen.findByText(t("voiceInput.settings.profiles.emptyHint")),
    ).toBeInTheDocument();
    expect(screen.getByText(t("voiceInput.settings.badge.notConfigured"))).toBeInTheDocument();
    expect(buttonByLabel(t("voiceInput.settings.profiles.create"))).toBeEnabled();
  });

  it("读取失败：显示可重试错误态，重试成功后渲染列表", async () => {
    apiMocks.getAsrProfiles.mockRejectedValueOnce(new Error("backend-down"));
    renderCard();

    expect(await screen.findByText(/backend-down/)).toBeInTheDocument();
    apiMocks.getAsrProfiles.mockResolvedValueOnce(makeProfilesState([makeAsrProfile()]));
    fireEvent.click(buttonByLabel(t("common.retry")));

    expect(await screen.findByText(makeAsrProfile().name)).toBeInTheDocument();
    expect(screen.queryByText(/backend-down/)).toBeNull();
  });

  it("达到 10 条上限时禁用「新建配置」", async () => {
    const profiles = Array.from({ length: 10 }, (_, index) =>
      makeAsrProfile({ id: "a_" + index, name: "Profile " + index }),
    );
    apiMocks.getAsrProfiles.mockResolvedValue(makeProfilesState(profiles, profiles[0].id));
    renderCard();

    await screen.findByText(profiles[0].name);
    expect(buttonByLabel(t("voiceInput.settings.profiles.create"))).toBeDisabled();
  });
});
