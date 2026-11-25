// SPDX-License-Identifier: Apache-2.0
/**
 * CR-11：代理口令的就地改 / 清除。
 *
 * 代理口令登记进「外部连接」页之后，这一行必须真的能改——而且必须走它自己的写入口
 * （`PUT /api/settings/network`）。两种语义最容易写错：
 *
 * - **写**：整份设置回写，只替换口令；模式 / 地址 / 证书开关原样带回（它们不在这一行改）；
 * - **清除**：空串在后端是"保留"，清除必须发 `__clear__` 哨兵。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionItem } from "../../types";
import {
  clearConnectionSecret,
  supportsInlineWrite,
  writeConnectionSecret,
} from "./connectionKeyWrite";

const getNetworkSettings = vi.fn();
const saveNetworkSettings = vi.fn();

vi.mock("../../api/settingsNetwork", () => ({
  getNetworkSettings: () => getNetworkSettings(),
  saveNetworkSettings: (payload: unknown) => saveNetworkSettings(payload),
}));

const proxyItem = {
  id: "network.proxy",
  label: "代理认证口令",
  kind: "credential",
  status: "saved",
  status_label: "已保存",
  detail: "",
  masked: "********",
  key_configured: true,
  protection: "dpapi",
  protection_label: "DPAPI 加密",
  protection_description: "",
  editable: true,
  write_hint: "",
  target_id: "",
  location: "",
} as ConnectionItem;

beforeEach(() => {
  getNetworkSettings.mockReset();
  saveNetworkSettings.mockReset();
  getNetworkSettings.mockResolvedValue({
    proxy_mode: "custom",
    proxy_url: "http://127.0.0.1:7890",
    proxy_username: "proxy-user",
    has_password: true,
    trust_system_certs: true,
    effective: {},
    detected: {},
    supports_socks: false,
    notice: "",
  });
  saveNetworkSettings.mockResolvedValue({});
});

describe("proxy credentials on the connections page", () => {
  it("advertises inline editing for network.proxy", () => {
    expect(supportsInlineWrite("network.proxy")).toBe(true);
  });

  it("writes only the password and keeps mode, address and certs", async () => {
    await writeConnectionSecret(proxyItem, "  new-secret  ");

    expect(saveNetworkSettings).toHaveBeenCalledWith({
      proxy_mode: "custom",
      proxy_url: "http://127.0.0.1:7890",
      proxy_username: "proxy-user",
      proxy_password: "new-secret",
      trust_system_certs: true,
    });
  });

  it("clears with the sentinel instead of an empty string", async () => {
    await clearConnectionSecret(proxyItem);

    expect(saveNetworkSettings).toHaveBeenCalledWith(
      expect.objectContaining({ proxy_password: "__clear__" }),
    );
  });
});
