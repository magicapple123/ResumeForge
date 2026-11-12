// SPDX-License-Identifier: Apache-2.0
/**
 * `UpdateCard` 的纯函数与浏览器环境探测（不含 JSX）。
 *
 * 从 `UpdateCard.tsx` 拆出来，理由只有一条：那个文件要装下检查/下载/安装三套状态机，
 * 单文件预算是 500 行。这里的东西全都没有 React 依赖（`t()` 是模块级取词，随时按当前
 * 语言求值），单独放一个文件既不增加耦合，也让卡片本体只留渲染与事件。
 */

import { GITHUB_REPO } from "../../config";
import { t, type MessageKey } from "../../i18n";
import type { UpdateCheckResult } from "../../types";

/**
 * 桌面壳的手动更新桥（`desktop/preload.js` 暴露的 `window.rfDesktop`）。
 *
 * 存在性是**能力**问题，不是平台问题：2.1 及更早的壳没有这个通道，`window.splash.isDesktop`
 * 却是从第一个版本就有的。所以判断只看这个函数在不在，绝不看 UA / platform / 版本号——
 * 旧壳里能力探测失败，卡片就退回 A 方案的三段式说明（菜单「帮助 → 检查更新」+ update.cmd）。
 *
 * 必须写进产物的限制：**B 方案救不了 2.0 旧壳**（旧壳没有这条 IPC 通道），那批用户只能靠
 * A 的文案 + 手动 Setup.exe；B 从 2.1 → 2.2 才生效。
 */
export interface DesktopUpdateBridge {
  checkUpdate?: () => Promise<unknown> | unknown;
}

/** 桥可用就返回它，桥缺失 / 形状不对一律返回 null（调用方据此回退 A 方案）。 */
export function getDesktopUpdateBridge(): DesktopUpdateBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as Window & { rfDesktop?: DesktopUpdateBridge }).rfDesktop;
  if (!bridge || typeof bridge !== "object") return null;
  return typeof bridge.checkUpdate === "function" ? bridge : null;
}

/** 发布页兜底地址：检查结果里带了就用它，没检查过（或走了桌面桥）就用仓库地址拼。 */
export function releasePageUrl(result: UpdateCheckResult | null): string {
  return result?.release_url || `${GITHUB_REPO}/releases`;
}

/**
 * 卡片内的错误提示：后端原文原样透传，没有原文时回退到语言包 key。
 * key 在渲染期才 `t()`——事件期求值会把当时的语言冻进 state，切语言后不会重译。
 */
export type CardError = { backendMessage: string } | { fallbackKey: MessageKey };

/** 把字节数换成可读体积；未知（null / 负数）时给语言包里的「未知大小」。 */
export function formatBytes(value: number | null): string {
  if (value === null || value < 0) return t("update.size.unknown");
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/**
 * 结论条的唯一一句话：**有没有新版**。
 *
 * 版本号、发布时间在 `.update-meta` 里各有专列，结论条不再复述（后端 `message` 与
 * 「有新版可用：x.y.z」是同一件事，两处同说会让用户以为有两个结论）。
 * 缺版本号时退回中性的「检查完成」。
 */
export function resultConclusion(result: UpdateCheckResult): string {
  if (!result.update_available) return t("update.result.uptodate");
  const version = result.latest_version || result.current_version;
  return version ? t("update.result.available", { version }) : t("update.result.title");
}
