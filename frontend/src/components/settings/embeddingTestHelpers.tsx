// SPDX-License-Identifier: Apache-2.0
/**
 * 「语义检索」卡测试共用工具：状态夹具、配置夹具、打开弹窗/填表。
 *
 * 只放测试用；`src/test/` 与 i18n 棘轮都把它当测试文件，不会进产品文案统计。
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen } from "@testing-library/react";
import type { EmbeddingProfile } from "../../api/settings";
import { makeStatus, type StatusOverrides } from "../../test/embeddingStatusFixture";
import { t } from "../../i18n";
import EmbeddingProviderCard from "./EmbeddingProviderCard";

export function makeProfile(overrides: Partial<EmbeddingProfile> = {}): EmbeddingProfile {
  return {
    id: "p_remote_1",
    name: "Company Azure",
    preset_id: "custom",
    base_url: "https://api.example.com/v1",
    model: "text-embedding-3-large",
    dim: 1024,
    batch_size: 25,
    endpoint_mode: "openai",
    host: "api.example.com",
    key_configured: true,
    updated_at: "2026-11-09T10:00:00+00:00",
    ...overrides,
  };
}

/** 已就绪的远程状态（带一条密钥已配置的命名配置）。 */
export function remoteReadyStatus(overrides: StatusOverrides = {}) {
  const profile = makeProfile();
  return makeStatus({
    state: "ready",
    provider: "openai-http",
    local: { state: "ready" },
    remote: {
      configured: true,
      enabled: true,
      host: "api.example.com",
      model: "text-embedding-3-large",
      dim: 1024,
      confirmed_hosts: ["api.example.com"],
    },
    profiles: [profile],
    active_profile_id: profile.id,
    active_profile_updated_at: profile.updated_at,
    local_profile_id: "p_local_1",
    ...overrides,
  });
}

/** 已就绪的本地状态（资源就绪、至少一条可切回的远程配置）。 */
export function localReadyStatus(overrides: StatusOverrides = {}) {
  const profile = makeProfile();
  return makeStatus({
    state: "ready",
    provider: "local-onnx",
    local: { state: "ready" },
    remote: {
      configured: false,
      enabled: false,
      confirmed_hosts: ["api.example.com"],
    },
    profiles: [profile],
    active_profile_id: "p_local_1",
    active_profile_updated_at: "2026-11-09T09:00:00+00:00",
    local_profile_id: "p_local_1",
    ...overrides,
  });
}

export function renderCard() {
  return render(
    <AntdApp>
      <EmbeddingProviderCard />
    </AntdApp>,
  );
}

/** 打开「新建配置」弹窗（列表标题行那颗主按钮）。 */
export async function openCreateModal() {
  fireEvent.click(
    await screen.findByRole("button", { name: t("embeddingSearch.remote.profiles.create") }),
  );
  return screen.findByRole("dialog");
}

/** 填一份可保存的远程配置（名称/地址/模型/密钥）。 */
export function fillProfileForm(values: {
  name?: string;
  baseUrl?: string;
  model?: string;
  key?: string;
}) {
  if (values.name !== undefined) {
    fireEvent.change(screen.getByLabelText(t("embeddingSearch.remote.modal.nameLabel")), {
      target: { value: values.name },
    });
  }
  if (values.baseUrl !== undefined) {
    fireEvent.change(screen.getByLabelText(t("embeddingSearch.remote.baseUrl.label")), {
      target: { value: values.baseUrl },
    });
  }
  if (values.model !== undefined) {
    fireEvent.change(screen.getByLabelText(t("embeddingSearch.remote.model.label")), {
      target: { value: values.model },
    });
  }
  if (values.key !== undefined) {
    fireEvent.change(screen.getByLabelText(t("embeddingSearch.remote.key.label")), {
      target: { value: values.key },
    });
  }
}

export { makeStatus };
export type { StatusOverrides };
