/** 应用生命周期接口。 */
import { ApiError, extractError, getFilenameFromDisposition } from "./client";
import { request } from "./client";

export interface ShutdownResult {
  status: string;
  message: string;
}

export interface DiagnosticsSnapshot {
  generated_at: string;
  app_version: string;
  events: Array<{
    at: string;
    event: string;
    request_id: string;
    details: Record<string, unknown>;
  }>;
}

/**
 * 退出应用（停止前端与后端进程）。
 *
 * 只有运行后端的本机能调用——局域网里的页面会收到 403。后端会先让启动器按记录停掉
 * Vite 进程树，再自己优雅退出；两个服务都停了以后，界面进入"已退出"状态。
 */
export function shutdownApp(): Promise<ShutdownResult> {
  return request("/system/shutdown", { method: "POST" });
}

export function getDiagnostics(): Promise<DiagnosticsSnapshot> {
  return request("/system/diagnostics");
}

/**
 * 下载脱敏诊断包（zip）：脱敏运行事件 + 系统信息 + 近期后端日志尾部。
 * 包里没有简历数据与密钥，可以直接贴进反馈。
 */
export async function exportDiagnostics(): Promise<{ blob: Blob; filename: string }> {
  const resp = await fetch("/api/system/diagnostics/export");
  if (!resp.ok) {
    throw new ApiError(await extractError(resp), resp.status);
  }
  const filename =
    getFilenameFromDisposition(resp.headers.get("Content-Disposition")) ??
    "resumeforge-diagnostics.zip";
  return { blob: await resp.blob(), filename };
}
