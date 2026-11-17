// SPDX-License-Identifier: Apache-2.0
/**
 * 出网与代理设置接口（T02）。
 *
 * 后端契约：`GET|PUT /api/settings/network`。响应里**永远没有口令**，只有
 * `has_password`；`effective` 是"这次请求实际走哪"，`detected` 是"这台机器检测到哪"，
 * 两者混用会让界面分不清"我在用代理"和"装着代理但我关了"。
 */
import { request } from "./client";

export type ProxyMode = "system" | "direct" | "custom";

/** 一条代理描述（脱敏）。 */
export interface ProxyView {
  source: string;
  source_label: string;
  var: string;
  scheme: string;
  host_port: string;
  has_auth: boolean;
  is_direct: boolean;
}

export interface NetworkSettings {
  proxy_mode: ProxyMode;
  proxy_url: string;
  proxy_username: string;
  has_password: boolean;
  /** T05：信任操作系统证书库（默认关）。 */
  trust_system_certs: boolean;
  effective: ProxyView;
  detected: ProxyView;
  supports_socks: boolean;
  notice: string;
}

export interface NetworkSettingsPayload {
  proxy_mode: ProxyMode;
  proxy_url?: string;
  proxy_username?: string;
  /** 留空 = 保留原口令；`__clear__` = 清除。 */
  proxy_password?: string;
  /** 不传 = 保持原值。 */
  trust_system_certs?: boolean;
}

export function getNetworkSettings(): Promise<NetworkSettings> {
  return request<NetworkSettings>("/settings/network");
}

export function saveNetworkSettings(payload: NetworkSettingsPayload): Promise<NetworkSettings> {
  return request<NetworkSettings>("/settings/network", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}
