// SPDX-License-Identifier: Apache-2.0
/**
 * `UpdateCard` 的纯函数与浏览器环境探测（不含 JSX）。
 *
 * 从 `UpdateCard.tsx` 拆出来，理由只有一条：那个文件要装下检查/下载/安装三套状态机，
 * 单文件预算是 500 行。这里的东西全都没有 React 依赖（`t()` 是模块级取词，随时按当前
 * 语言求值），单独放一个文件既不增加耦合，也让卡片本体只留渲染与事件。
 */

import { GITHUB_REPO } from "../../config";
import { t, type Locale, type MessageKey } from "../../i18n";
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

// GitHub releases place one language in the main body and the translation
// inside a details block. Strip disclosure markup before the Markdown renderer.
export function selectReleaseNotes(body: string, locale: Locale, localizedOnly = false): string {
  const sections = new Map<Locale, string>();
  const main = body
    .replace(
      /<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)(?:<\/details>|$)/gi,
      (_block, label: string, content: string) => {
        // 语言判断**直接对原始 label 做**，不再先剥标签。
        //
        // 以前这里是 `label.replace(/<[^>]*>/g, "")`——一次式的多字符替换，属于不完整的
        // sanitization（CodeQL #136 `js/incomplete-multi-character-sanitization`）：
        // 输入 `<<script` 这种没有 `>` 收尾的残片时正则一个字符都不匹配，输出的
        // `summary` 里照样留着 `<script`。判断语言本来也不需要干净的纯文本——`<code>`
        // 之类的行内标记夹在中间，`/中文|简体/` 一样命中，所以干脆不剥。
        // i18n-ok: language markers from published GitHub notes
        const language = /中文|简体|繁體|Chinese|zh[-_]/i.test(label)
          ? "zh-CN"
          : /English|en[-_]US/i.test(label)
            ? "en-US"
            : null;
        if (!language) {
          // 没有语言标记时要把 label 当纯文本拼回正文，所以这里仍需去掉尖括号——但用
          // **单字符**替换：每步只删掉一个 `<` 或 `>`，不可能拼出新的尖括号，因此
          // 不存在"剥一次还剩半截"的残留。代价是 label 里若真有行内标签，标签名会留在
          // 文字里（如 `<code>x</code>` → `codex/code`）；无语言标记的 summary 在实践
          // 中是纯文本（`中文版` / `English` 那类都能命中语言），这个代价可以接受，
          // 换掉的是一条 security 告警和一类静默残留。
          return "\n" + label.replace(/[<>]/g, "").trim() + "\n\n" + content.trim() + "\n";
        }
        sections.set(language, content.trim());
        return "\n";
      },
    )
    .trim();
  const translation = sections.get(locale);
  if (translation !== undefined) return translation;
  if (localizedOnly && !sections.size && main) {
    // Older releases sometimes have just one language. Ignore code and links
    // when deciding whether any explanatory text is available in this locale.
    const prose = main.replace(/`[^`]*`|https?:\/\/\S+/g, "");
    const han = (prose.match(/\p{Script=Han}/gu) ?? []).length;
    const words = (prose.match(/[A-Za-z]{2,}/g) ?? []).length;
    if (locale === "zh-CN" ? !han : han > words * 2) return "";
  }
  return main;
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

/**
 * 这次检查**有没有**得出「有没有新版本」的结论。
 *
 * 判成"没结论"之后，界面把「未提供」换成可解释的降级文案——两者读起来像同义词，
 * 对用户却是相反的处境：前者是"上游没给这个信息"，后者是"我们没问到"。桌面壳有
 * 自己的出网链路（Chromium 栈、走系统代理），同一时刻可能已经查到 2.3.0 并弹窗；
 * 设置页此时还写「未提供」，就是同一件事给出两个结论。
 *
 * 两个条件都认：
 * - `degraded`：新后端明确说了"没问到"；
 * - `checked_at` 有值而 `latest_version` 为空：老后端没有那个字段，但"查过了却没有
 *   版本号"本身就说明没有结论，界面不该因此退回「未提供」。
 */
export function isUnconfirmed(result: UpdateCheckResult | null): boolean {
  if (!result) return false;
  if (result.degraded === true) return true;
  return Boolean(result.checked_at) && !result.latest_version;
}
