// SPDX-License-Identifier: Apache-2.0

/**
 * 后端运行形态（GET /api/system/form）。
 *
 * 桌面安装壳（Electron）与控制台/开发态的**更新方式不同**：桌面安装里 `PROJECT_ROOT`
 * 是 `resources/payload`，而仓库自带的更新包是源码形态整包（不含 python-runtime.zip、
 * 不含 desktop/），页面内"下载 zip 覆盖"在原理上补不齐依赖。前端据此决定是否显示
 * 页面内的下载/安装入口。
 */
export interface AppForm {
  /** 桌面壳启动后端时注入 RF_DESKTOP_SHELL=1；控制台与开发态为 false。 */
  desktop: boolean;
  /** 后端所在平台（`sys.platform`，如 `win32` / `darwin`）。 */
  platform: string;
  app_version: string;
}

/** 更新检查结果与可安装包信息。 */
export interface UpdateCheckResult {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  release_name: string;
  release_url: string;
  published_at: string;
  notes: string;
  message: string;
  checked_at: string | null;
  download_url: string;
  download_size: number | null;
  asset_name: string;
  /** 发布时旁边的 `.sha256` 附件地址；下载完用它核对。 */
  checksum_url: string;
  installable: boolean;
}

export type UpdateInstallState = "success" | "failed" | "interrupted" | "installing";

/**
 * 上一次应用内更新的结果，由后端读更新器写的状态文件得出。
 *
 * **成没成以后端为准**：前端不再自己记"我点过安装了"——那种记法在安装失败时
 * 会对着用户说"已更新"。
 */
export interface UpdateInstallResult {
  state: UpdateInstallState;
  from_version: string;
  target_version: string;
  message: string;
  log: string;
  restart: boolean;
}

export type UpdateDownloadState = "idle" | "downloading" | "ready" | "installing" | "failed";

export interface UpdateStatus {
  state: UpdateDownloadState;
  current_version: string;
  target_version: string;
  progress: number;
  downloaded_bytes: number;
  total_bytes: number | null;
  background: boolean;
  installable: boolean;
  message: string;
}
