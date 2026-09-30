/** 应用生命周期接口。 */
import { request } from "./client";

export interface ShutdownResult {
  status: string;
  message: string;
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
