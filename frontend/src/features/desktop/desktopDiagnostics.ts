// SPDX-License-Identifier: Apache-2.0
/**
 * 「帮助 → 复制诊断信息」（#34D）。
 *
 * 本会话 80% 的排查靠日志（语音字节数、RAG 回退原因、重排耗时、菜单蓝框规则来源），
 * 而菜单里原来只有「打开日志目录」——等于让用户自己在几 MB 里 grep。这里合成一份可以
 * 直接贴给支持者的摘要：版本 / 平台 / 数据目录 / 最近 WARN、ERROR / 当前模型配置 / 开关。
 *
 * 密钥的处理是**结构性的，不是事后正则抹**：
 *  - 模型配置只取 provider / base_url / model / api_style，以及 api_key 的**布尔**；
 *    api_key 的字符串永远不进输出（后端 GET /settings/llm 返回的本身已是 ******** 掩码，
 *    这里连掩码都不带，只报「已配置 / 未配置」）。
 *  - 日志行由主进程的 diagnostic-summary 先做令牌兜底脱敏再交过来。
 *
 * 日志来自主进程（它才知道日志目录与文件），设置来自渲染层（它才知道怎么问后端）；
 * 两边都拿不到时也照样输出——诊断信息缺一块比"点了没反应"好。
 */
import {
  getAssistantRelaxedMode,
  getLLMConfig,
  getReminderPopupSetting,
  getWebFormRelaxedMode,
} from "../../api/settings";
import { t } from "../../i18n";
import type { LLMConfig } from "../../types";
import type { DesktopMenuActionReply, DesktopShellBridge } from "./desktopShellBridge";

/** 主进程 help.getDiagnostics 的返回（desktop/lib/desktop-menu.js）。 */
export interface DesktopDiagnosticsReport {
  version?: string;
  platform?: string;
  dataDir?: string;
  logDir?: string;
  /** 已脱敏的最近 WARN / ERROR 行（按时间顺序）。 */
  problems?: string[];
}

/** 模型配置里**可以带出去**的字段；api_key 不在其中（只有布尔）。 */
export interface DesktopModelSummary {
  provider: string;
  model: string;
  baseUrl: string;
  apiStyle: string;
  apiKeyConfigured: boolean;
}

/** 一行「开关状态」：label / value 都已经本地化（复制件跟着界面语言走）。 */
export interface DiagnosticsRow {
  label: string;
  value: string;
}

export interface DesktopDiagnosticsSettings {
  model: DesktopModelSummary | null;
  rows: DiagnosticsRow[];
}

/** 渲染层本地就能确定的上下文（不花一次网络往返）。 */
export interface DiagnosticsContext {
  theme: string;
  locale: string;
}

interface DiagnosticsLoaders {
  llmConfig: () => Promise<LLMConfig>;
  reminderPopup: () => Promise<{ enabled: boolean }>;
  webFormRelaxed: () => Promise<{ enabled: boolean }>;
  assistantRelaxed: () => Promise<{ enabled: boolean }>;
}

const DEFAULT_LOADERS: DiagnosticsLoaders = {
  llmConfig: getLLMConfig,
  reminderPopup: getReminderPopupSetting,
  webFormRelaxed: getWebFormRelaxedMode,
  assistantRelaxed: getAssistantRelaxedMode,
};

/** 模型配置 → 可带出去的四项 + 一位"是否配置"。api_key 原文在这里被丢掉。 */
export function modelSummary(
  config: Pick<LLMConfig, "provider" | "base_url" | "model" | "api_style" | "api_key">,
): DesktopModelSummary {
  return {
    provider: config.provider?.trim() || "-",
    model: config.model?.trim() || "-",
    baseUrl: config.base_url?.trim() || "-",
    apiStyle: config.api_style || "openai",
    apiKeyConfigured: Boolean(config.api_key && config.api_key.trim()),
  };
}

function toggleText(enabled: boolean | null): string {
  if (enabled === null) return t("appHeader.desktopMenu.diagnostics.readFailed");
  return enabled
    ? t("appHeader.desktopMenu.diagnostics.on")
    : t("appHeader.desktopMenu.diagnostics.off");
}

/**
 * 拉取设置侧的内容。四个接口彼此独立，任何一个失败只让那一项显示「读取失败」，
 * 不让整份诊断信息失败（后端没起来时恰恰最需要这份东西）。
 */
export async function loadDesktopDiagnosticsSettings(
  context: DiagnosticsContext,
  loaders: Partial<DiagnosticsLoaders> = {},
): Promise<DesktopDiagnosticsSettings> {
  const resolved = { ...DEFAULT_LOADERS, ...loaders };
  const [llm, reminder, webForm, assistant] = await Promise.allSettled([
    resolved.llmConfig(),
    resolved.reminderPopup(),
    resolved.webFormRelaxed(),
    resolved.assistantRelaxed(),
  ]);
  const enabledOf = (result: PromiseSettledResult<{ enabled: boolean }>): boolean | null =>
    result.status === "fulfilled" ? Boolean(result.value?.enabled) : null;
  return {
    model: llm.status === "fulfilled" ? modelSummary(llm.value) : null,
    rows: [
      {
        label: t("appHeader.desktopMenu.diagnostics.switch.reminderPopup"),
        value: toggleText(enabledOf(reminder)),
      },
      {
        label: t("appHeader.desktopMenu.diagnostics.switch.webFormRelaxed"),
        value: toggleText(enabledOf(webForm)),
      },
      {
        label: t("appHeader.desktopMenu.diagnostics.switch.assistantRelaxed"),
        value: toggleText(enabledOf(assistant)),
      },
      // 主题 / 语言来自渲染层本地状态，不走网络。
      { label: t("appHeader.desktopMenu.diagnostics.switch.theme"), value: context.theme },
      { label: t("appHeader.desktopMenu.diagnostics.switch.locale"), value: context.locale },
    ],
  };
}

/** 合成最终文本。纯函数：同一个 report + settings 永远得到同一份输出（便于测试断言）。 */
export function composeDiagnosticsText(
  report: DesktopDiagnosticsReport | null,
  settings: DesktopDiagnosticsSettings,
): string {
  const lines: string[] = [t("appHeader.desktopMenu.diagnostics.title"), ""];
  lines.push(t("appHeader.desktopMenu.diagnostics.version", { version: report?.version || "-" }));
  lines.push(
    t("appHeader.desktopMenu.diagnostics.platform", { platform: report?.platform || "-" }),
  );
  lines.push(t("appHeader.desktopMenu.diagnostics.dataDir", { path: report?.dataDir || "-" }));
  lines.push(t("appHeader.desktopMenu.diagnostics.logDir", { path: report?.logDir || "-" }));
  lines.push("");

  lines.push(t("appHeader.desktopMenu.diagnostics.model"));
  if (settings.model) {
    // provider / model / api_style 都是协议标识，不翻译（翻译了反而对不上配置界面）。
    lines.push(
      `- ${settings.model.provider} / ${settings.model.model} / ${settings.model.apiStyle}`,
    );
    lines.push(t("appHeader.desktopMenu.diagnostics.baseUrl", { url: settings.model.baseUrl }));
    lines.push(
      settings.model.apiKeyConfigured
        ? t("appHeader.desktopMenu.diagnostics.apiKeyConfigured")
        : t("appHeader.desktopMenu.diagnostics.apiKeyMissing"),
    );
  } else {
    lines.push(`- ${t("appHeader.desktopMenu.diagnostics.readFailed")}`);
  }
  lines.push("");

  lines.push(t("appHeader.desktopMenu.diagnostics.switches"));
  for (const row of settings.rows) lines.push(`- ${row.label}: ${row.value}`);
  lines.push("");

  const problems = Array.isArray(report?.problems) ? report.problems : [];
  lines.push(
    problems.length > 0
      ? t("appHeader.desktopMenu.diagnostics.problems", { count: String(problems.length) })
      : t("appHeader.desktopMenu.diagnostics.problemsEmpty"),
  );
  for (const problem of problems) lines.push(`  ${problem}`);
  return lines.join("\n");
}

export type ClipboardWriter = (text: string) => Promise<boolean>;

/**
 * 写剪贴板：优先异步 Clipboard API；被策略拒了就用 textarea + execCommand 兜底。
 * 菜单点击本身是用户手势，两条路都不需要额外权限。
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 继续走兜底：焦点/权限被拒时 execCommand 仍可能成功。
  }
  return copyWithTextarea(text);
}

function copyWithTextarea(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "true");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  try {
    area.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

export interface DesktopDiagnosticsDeps {
  readReport?: (bridge: DesktopShellBridge) => Promise<DesktopDiagnosticsReport | null>;
  loadSettings?: (context: DiagnosticsContext) => Promise<DesktopDiagnosticsSettings>;
  writeClipboard?: ClipboardWriter;
}

async function readMainReport(
  bridge: DesktopShellBridge,
): Promise<DesktopDiagnosticsReport | null> {
  const pending = bridge.menuAction?.("help.getDiagnostics");
  if (!pending) return null;
  const reply: DesktopMenuActionReply | undefined = await pending;
  if (!reply?.ok || !reply.result || typeof reply.result !== "object") return null;
  return reply.result as DesktopDiagnosticsReport;
}

export interface DiagnosticsCopyResult {
  ok: boolean;
  text: string;
}

/** 菜单动作「复制诊断信息」的全流程：取报告 → 补设置 → 合成 → 写剪贴板。 */
export async function copyDesktopDiagnostics(
  bridge: DesktopShellBridge,
  context: DiagnosticsContext,
  deps: DesktopDiagnosticsDeps = {},
): Promise<DiagnosticsCopyResult> {
  const readReport = deps.readReport ?? readMainReport;
  const loadSettings = deps.loadSettings ?? loadDesktopDiagnosticsSettings;
  const write = deps.writeClipboard ?? writeClipboardText;
  let report: DesktopDiagnosticsReport | null = null;
  try {
    report = await readReport(bridge);
  } catch {
    // 主进程动作失败：report 保持 null，仍然输出设置侧内容（缺一块比点了没反应好）。
  }
  let settings: DesktopDiagnosticsSettings;
  try {
    settings = await loadSettings(context);
  } catch {
    settings = { model: null, rows: [] };
  }
  const text = composeDiagnosticsText(report, settings);
  const ok = await write(text);
  return { ok, text };
}
