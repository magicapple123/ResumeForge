// SPDX-License-Identifier: Apache-2.0
/**
 * 「语义检索」卡测试用的 GET /status 夹具（与契约 §3 的字段一一对应）。
 *
 * 放在 src/test/ 下是因为它只服务测试：这个目录被 i18n / 文案守卫排除，
 * 夹具里的中文注释与裸字符串不会进棘轮。
 */
import type { EmbeddingLocalStatus, EmbeddingRemoteStatus, EmbeddingStatus } from "../api/settings";

type StatusOverrides = Omit<Partial<EmbeddingStatus>, "local" | "remote"> & {
  local?: Partial<EmbeddingLocalStatus>;
  remote?: Partial<EmbeddingRemoteStatus>;
};

function makeStatus(overrides: StatusOverrides = {}): EmbeddingStatus {
  const base: EmbeddingStatus = {
    state: "not_configured",
    provider: "",
    last_error: "",
    local: {
      supported: true,
      platform: "windows-x64",
      variant: "int8_avx2",
      download_bytes: 111308819,
      state: "not_downloaded",
      progress: 0,
      error: "",
      model: "granite-embedding-97m-multilingual-r2",
      runtime_version: "1.31.1",
    },
    remote: {
      configured: false,
      enabled: false,
      host: "",
      model: "",
      dim: 0,
      endpoint_mode: "openai",
      batch_size: 25,
      confirmed_hosts: [],
      pending_host: "",
      error: "",
    },
    runtime: { available: false, version: "1.31.1" },
    profiles: [],
    active_profile_id: "",
    active_profile_updated_at: "",
    local_profile_id: "",
  };
  return {
    ...base,
    ...overrides,
    local: { ...base.local, ...(overrides.local ?? {}) },
    remote: { ...base.remote, ...(overrides.remote ?? {}) },
  };
}

export { makeStatus };
export type { StatusOverrides };
