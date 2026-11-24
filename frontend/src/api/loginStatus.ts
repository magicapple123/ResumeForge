// SPDX-License-Identifier: Apache-2.0
/** 「登录状态」面板的前端契约（Q12 / F07）：来源读取、单项检测、重登、网申站点。 */
import { request } from "./client";

export type LoginStatusValue = "ok" | "logged-out" | "expired" | "unknown" | "unchecked";

/** 一个网申站点（F07）：host 是服务端派生的唯一标识，前端只传它，不传 URL。 */
export interface LoginStatusSite {
  host: string;
  label: string;
  probe_url: string;
  status: LoginStatusValue;
  checked_at: string;
  detail: string;
  /** 账号备注（原条目 8 A1）：用户自己填的一行文字，空串 = 未填写。 */
  account: string;
}

export interface LoginStatusRow {
  id: string;
  label: string;
  /** 浏览器类会真的拉起窗口（门户 Cookie 那一行随「状态回读」一并移除）。 */
  browser: boolean;
  probe_url: string;
  status: LoginStatusValue;
  checked_at: string;
  detail: string;
  /** 这一行的 host；汇总行（网申有站点时）为空串，备注按站点各自带着。 */
  host: string;
  /** 该 host 的账号备注（空串 = 未填写）。 */
  account: string;
  /** 仅「网申浏览器」：逐站点状态（空数组 = 没有历史，走单行口径）。 */
  sites: LoginStatusSite[];
}

/** 一个 host 的账号备注（原条目 8 A1）。`note` 是**落库后**的值，已按 64 字符截断。 */
export interface AccountNote {
  host: string;
  note: string;
}

export interface WebFormSiteList {
  items: LoginStatusSite[];
  total: number;
  truncated: number;
}

/** 只读缓存：**不会触发任何检测**（浏览器类检测会弹窗、耗时数秒）。 */
export function listLoginStatuses(): Promise<LoginStatusRow[]> {
  return request("/login-status");
}

/** 跑一次检测。同一来源 60 秒内重复点会被后端 429 拒绝（带剩余秒数）。 */
export function checkLoginStatus(id: string): Promise<LoginStatusRow> {
  return request(`/login-status/${id}/check`, { method: "POST" });
}

/** 重新登录：打开该来源的登录页，返回 `opened`。 */
export function relogin(id: string): Promise<{ id: string; action: string; url: string }> {
  return request(`/login-status/${id}/relogin`, { method: "POST" });
}

/** 网申站点清单（只读缓存）：`total` / `truncated` 用来提示"还有几个没列出来"。 */
export function listWebformSites(): Promise<WebFormSiteList> {
  return request("/login-status/webform-sites");
}

/** 检测一个网申站点；host 不在服务端清单里会被 404。 */
export function checkWebformSite(host: string): Promise<LoginStatusSite> {
  return request("/login-status/webform-sites/check", {
    method: "POST",
    body: JSON.stringify({ host }),
  });
}

/** 在该站点上重新登录（打开它的登录页，而不是投递站点的入口页）。 */
export function reloginWebformSite(
  host: string,
): Promise<{ id: string; action: string; url: string }> {
  return request("/login-status/webform-sites/relogin", {
    method: "POST",
    body: JSON.stringify({ host }),
  });
}

/**
 * 读一个 host 的账号备注（原条目 8 A1）。只读 KV，不触发检测。
 *
 * 面板加载时备注已随行下发（`account`），这个 GET 用于单独刷新一行。
 */
export function getAccountNote(host: string): Promise<AccountNote> {
  return request(`/login-status/accounts/${encodeURIComponent(host)}`);
}

/** 写 / 清除账号备注：`note` 空串 = 清除，超长由服务端截到 64 字符，返回落库后的值。 */
export function saveAccountNote(host: string, note: string): Promise<AccountNote> {
  return request(`/login-status/accounts/${encodeURIComponent(host)}`, {
    method: "PUT",
    body: JSON.stringify({ note }),
  });
}
