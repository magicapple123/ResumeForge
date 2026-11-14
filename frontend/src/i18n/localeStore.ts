// SPDX-License-Identifier: Apache-2.0
import { DEFAULT_LOCALE, isLocale, type Locale } from "./localeTypes";

export const LOCALE_STORAGE_KEY = "rf.locale";
export interface LocaleSnapshot {
  readonly locale: Locale;
  readonly revision: number;
  readonly provisional: boolean;
}

/**
 * 首启（既没有本地选择、服务端也没存过值）时按系统语言决定默认值。
 *
 * 三平台通用：Electron 的 `navigator.language` 就是系统语言——桌面壳没有调用
 * `appendSwitch("lang")`（见 `desktop/main.js`），所以 Chromium 不会拿到被改写的语言。
 * 规则是"按顺序取第一个受支持的标签"：`zh`/`zh-*` → `zh-CN`，`en`/`en-*` → `en-US`，
 * 全都不匹配（含 `ja-JP`、`de-DE` 以及 C locale 下的 `C`）或有语言标签为空 → `en-US`。
 *
 * 为什么非中文一律回落**英文**而不是 `DEFAULT_LOCALE`（zh-CN）：AppImage 官方目录要求
 * "非中文环境以英文启动"——收录测试在 C locale 下截图，中文界面会被判
 * `ERROR: The screenshot shows text mostly not in English but in Chinese script`
 * （PR AppImage/appimage.github.io#11983）。这条规则同样让英文用户第一次启动就看到英文。
 *
 * 为什么探测只影响首启、不覆盖用户选择：调用点在 `readInitialLocale()` 的**兜底分支**——
 * `localStorage` 里有合法值就直接返回它。桌面版每次启动用随机端口（`findFreePort()`），
 * `localStorage` 按 origin 隔离、因此每次都是空的，真正记住用户选择的是服务端
 * （`localePersistence.hydrateLocaleFromServer`，服务端返回 null 时它会把当前内存值写库）。
 * 也就是说：库里有值时由服务端覆盖这里的探测结果；只有"谁都没选过"时探测才生效一次。
 */
export function detectPreferredLocale(languages: readonly string[] | undefined): Locale {
  if (!languages) return "en-US";
  for (const candidate of languages) {
    if (typeof candidate !== "string") continue;
    const tag = candidate.trim().toLowerCase();
    if (tag === "zh" || tag.startsWith("zh-")) return "zh-CN";
    if (tag === "en" || tag.startsWith("en-")) return "en-US";
  }
  return "en-US";
}

/** 系统语言标签；拿不到浏览器信息时返回 `undefined`（SSR / 缺少 navigator 的环境）。 */
function readSystemLanguages(): readonly string[] | undefined {
  if (typeof navigator === "undefined") return undefined;
  const languages = navigator.languages;
  if (Array.isArray(languages) && languages.length > 0) return languages;
  const primary = navigator.language;
  return typeof primary === "string" && primary !== "" ? [primary] : [];
}

function readInitialLocale(): Locale {
  try {
    const stored =
      typeof window === "undefined" ? null : window.localStorage.getItem(LOCALE_STORAGE_KEY);
    // 用户手动选择过的语言是快路径：一旦有值就绝不让系统探测覆盖它。
    if (isLocale(stored)) return stored;
  } catch {
    // 存储被禁用（隐私模式 / 企业策略）时不要连首启都失败，继续走系统语言探测。
  }
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  return detectPreferredLocale(readSystemLanguages());
}

let snapshot: LocaleSnapshot = Object.freeze({
  locale: readInitialLocale(),
  revision: 0,
  provisional: true,
});
let choiceVersion = 0;
const listeners = new Set<() => void>();
const serverSnapshot: LocaleSnapshot = Object.freeze({
  locale: DEFAULT_LOCALE,
  revision: 0,
  provisional: true,
});

export function applyDocumentLocale(locale: Locale): void {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}
applyDocumentLocale(snapshot.locale);

export function getSnapshot(): LocaleSnapshot {
  return snapshot;
}

export function getServerSnapshot(): LocaleSnapshot {
  return serverSnapshot;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Registration invalidates caches without publishing a locale change. */
export function advanceRevision(): void {
  snapshot = Object.freeze({ ...snapshot, revision: snapshot.revision + 1 });
}

export function getChoiceVersion(): number {
  return choiceVersion;
}

function publishLocale(locale: Locale, provisional: boolean): void {
  const changed = snapshot.locale !== locale;
  snapshot = Object.freeze({ locale, provisional, revision: snapshot.revision + 1 });
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Keep the in-memory choice even when browser storage is unavailable.
  }
  applyDocumentLocale(locale);
  if (changed) for (const listener of [...listeners]) listener();
}

/** Synchronous local choice; server writes live in localePersistence. */
export function selectLocale(locale: Locale): number {
  choiceVersion += 1;
  publishLocale(locale, true);
  return choiceVersion;
}

export function applyServerLocale(locale: Locale): void {
  publishLocale(locale, false);
}

export function confirmLocalePersistence(version: number): void {
  if (version === choiceVersion) {
    snapshot = Object.freeze({ ...snapshot, provisional: false, revision: snapshot.revision + 1 });
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === LOCALE_STORAGE_KEY && isLocale(event.newValue)) {
      choiceVersion += 1;
      publishLocale(event.newValue, true);
    }
  });
}
