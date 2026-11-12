// SPDX-License-Identifier: Apache-2.0
/**
 * 「帮助 → 复制诊断信息」（#34D）的纯函数与合成流程。
 *
 * 最要紧的一条是**不泄露 API Key**：这里用一份带真实形态密钥的配置做反证——输出里
 * 不允许出现任何密钥片段。脱敏是结构性的（只取布尔），不是拿正则事后抹。
 */
import { describe, expect, it, vi } from "vitest";
import {
  composeDiagnosticsText,
  copyDesktopDiagnostics,
  loadDesktopDiagnosticsSettings,
  modelSummary,
  type DesktopDiagnosticsReport,
  type DesktopDiagnosticsSettings,
} from "./desktopDiagnostics";
import { t } from "../../i18n";
import type { DesktopShellBridge } from "./desktopShellBridge";

const settingsApi = vi.hoisted(() => ({
  getLLMConfig: vi.fn(),
  getReminderPopupSetting: vi.fn(),
  getWebFormRelaxedMode: vi.fn(),
  getAssistantRelaxedMode: vi.fn(),
}));
vi.mock("../../api/settings", () => settingsApi);

const REAL_LOOKING_KEY = "sk-live-1234567890abcdef";

function llmConfig(apiKey: string) {
  return {
    provider: "deepseek",
    base_url: "https://api.deepseek.com",
    api_key: apiKey,
    model: "deepseek-chat",
    api_style: "openai" as const,
    temperature: 0.7,
    timeout_seconds: 60,
    max_tokens: 2000,
    top_p: null,
    frequency_penalty: null,
    presence_penalty: null,
    seed: null,
    top_k: null,
    repetition_penalty: null,
    stop: [],
    thinking_budget: null,
    thinking_enabled: false,
    thinking_effort: "",
    thinking_style: "auto",
    extra_body: {},
  };
}

const report: DesktopDiagnosticsReport = {
  version: "2.1.0",
  platform: "win32",
  dataDir: "C:/Users/example/AppData/Roaming/ResumeForge/data",
  logDir: "C:/Users/example/AppData/Local/ResumeForge/runtime/logs",
  problems: ["[desktop-main.log] 2026-11-11 21:00:00 WARN backend slow"],
};

const settings: DesktopDiagnosticsSettings = {
  model: modelSummary(llmConfig(REAL_LOOKING_KEY)),
  rows: [
    { label: t("appHeader.desktopMenu.diagnostics.switch.reminderPopup"), value: "开" },
    { label: t("appHeader.desktopMenu.diagnostics.switch.theme"), value: "dark" },
  ],
};

describe("模型配置摘要（Key 脱敏）", () => {
  it("只保留 provider/base_url/model/api_style 与「是否配置」", () => {
    const summary = modelSummary(llmConfig(REAL_LOOKING_KEY));
    expect(summary).toEqual({
      provider: "deepseek",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      apiStyle: "openai",
      apiKeyConfigured: true,
    });
    expect(JSON.stringify(summary)).not.toContain("sk-live");
  });

  it("后端返回掩码串时同样只报布尔，掩码本身也不带出去", () => {
    const summary = modelSummary(llmConfig("********"));
    expect(summary.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("********");
  });

  it("空 Key = 未配置", () => {
    expect(modelSummary(llmConfig("")).apiKeyConfigured).toBe(false);
  });
});

describe("composeDiagnosticsText", () => {
  it("包含版本 / 平台 / 数据目录 / 日志目录 / 模型 / 开关 / 最近告警", () => {
    const text = composeDiagnosticsText(report, settings);
    expect(text).toContain(t("appHeader.desktopMenu.diagnostics.title"));
    expect(text).toContain("2.1.0");
    expect(text).toContain("win32");
    expect(text).toContain(report.dataDir);
    expect(text).toContain(report.logDir);
    expect(text).toContain("deepseek-chat");
    expect(text).toContain("https://api.deepseek.com");
    expect(text).toContain(t("appHeader.desktopMenu.diagnostics.apiKeyConfigured"));
    expect(text).toContain("[desktop-main.log]");
    expect(text).toContain("dark");
  });

  it("**任何情况下都不出现明文 API Key**（写完后 grep 的第一道闸）", () => {
    const text = composeDiagnosticsText(report, settings);
    expect(text).not.toContain(REAL_LOOKING_KEY);
    expect(text).not.toContain("sk-live");
    expect(text).not.toContain("1234567890");
  });

  it("主进程报告缺失时照样输出（诊断信息缺一块比点了没反应好）", () => {
    const text = composeDiagnosticsText(null, settings);
    expect(text).toContain(t("appHeader.desktopMenu.diagnostics.title"));
    expect(text).toContain(t("appHeader.desktopMenu.diagnostics.problemsEmpty"));
  });

  it("没有 WARN/ERROR 时明确写「无」，不是留空", () => {
    const text = composeDiagnosticsText({ ...report, problems: [] }, settings);
    expect(text).toContain(t("appHeader.desktopMenu.diagnostics.problemsEmpty"));
  });
});

describe("loadDesktopDiagnosticsSettings", () => {
  it("接口失败的那一项显示「读取失败」，其余项照常", async () => {
    settingsApi.getLLMConfig.mockRejectedValueOnce(new Error("backend down"));
    settingsApi.getReminderPopupSetting.mockResolvedValueOnce({ enabled: true });
    settingsApi.getWebFormRelaxedMode.mockResolvedValueOnce({ enabled: false });
    settingsApi.getAssistantRelaxedMode.mockRejectedValueOnce(new Error("nope"));
    const loaded = await loadDesktopDiagnosticsSettings({ theme: "light", locale: "zh-CN" });
    expect(loaded.model).toBeNull();
    expect(loaded.rows[0].value).toBe(t("appHeader.desktopMenu.diagnostics.on"));
    expect(loaded.rows[1].value).toBe(t("appHeader.desktopMenu.diagnostics.off"));
    expect(loaded.rows[2].value).toBe(t("appHeader.desktopMenu.diagnostics.readFailed"));
    expect(loaded.rows.map((row) => row.label)).toContain(
      t("appHeader.desktopMenu.diagnostics.switch.theme"),
    );
  });
});

describe("copyDesktopDiagnostics", () => {
  it("合成文本并写剪贴板；成功时 ok=true", async () => {
    const written: string[] = [];
    const bridge = {
      menuAction: vi.fn(async () => ({ ok: true, result: report })),
    } as unknown as DesktopShellBridge;
    const outcome = await copyDesktopDiagnostics(
      bridge,
      { theme: "light", locale: "en-US" },
      {
        loadSettings: async () => settings,
        writeClipboard: async (text) => {
          written.push(text);
          return true;
        },
      },
    );
    expect(bridge.menuAction).toHaveBeenCalledWith("help.getDiagnostics");
    expect(outcome.ok).toBe(true);
    expect(written).toEqual([outcome.text]);
    expect(outcome.text).toContain("2.1.0");
    expect(outcome.text).not.toContain(REAL_LOOKING_KEY);
  });

  it("主进程动作失败 / 写剪贴板失败都不抛，如实返回 ok=false", async () => {
    const bridge = {
      menuAction: vi.fn(async () => {
        throw new Error("ipc unavailable");
      }),
    } as unknown as DesktopShellBridge;
    const outcome = await copyDesktopDiagnostics(
      bridge,
      { theme: "light", locale: "zh-CN" },
      { loadSettings: async () => settings, writeClipboard: async () => false },
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain(t("appHeader.desktopMenu.diagnostics.title"));
  });
});
