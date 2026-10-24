// SPDX-License-Identifier: Apache-2.0
/**
 * 简历字体接口：内置思源黑体的**按需下载 / 取消 / 删除**，以及历史导入字体的清单与改名。
 *
 * **为什么从 `api/settings.ts` 拆出来**：那个文件已经 480 行（单文件 500 行零豁免），
 * 而本批要在字体这一组上再加两个函数。字体这一组在依赖上是自洽的最小闭包——只用到
 * `request` 与它自己的类型，不碰 LLM / 备份 / 数据集任何一项，所以整组搬走、
 * `settings.ts` re-export，既有 `import { activateResumeFont } from "../api/settings"`
 * 的调用点一行都不用改。
 *
 * ## 三条口径
 *
 * 1. **状态唯一来源是 `state`**（`idle | downloading | failed | done`）。`downloaded` 只是
 *    它的派生快照；`cancelling` 只是提示位，任何判断分支都不得把它当独立状态用。
 * 2. 两次请求返回同一结构（`GET` 与 `POST .../download` 都是 `BuiltinFontStatus`），
 *    所以前端只需要一个类型、一份轮询逻辑。
 * 3. 错误一律走既有的 `ApiError`：`409` 已在下载（含 `DELETE` 撞上下载）、`507` 磁盘不足、
 *    `404` 未下载（`DELETE`）、`500` 删除失败。**后端 `detail` 只写原因**，"请 / 可以"由前端补。
 */
import { request } from "./client";

/** 内置字体的磁盘文件名（`format_config.font` 存的是它，不是 `id`）。 */
export const BUILTIN_FONT_FILE = "SourceHanSansSC-Regular.otf";

/**
 * 内置字体两个字重的合计字节数（Regular 16,529,832 + Bold 16,963,428）。
 *
 * 只在"还没拿到后端状态"时给用户一个体量预估（约 32 MB）；一旦有 `size_total` 就以
 * 后端为准——真实体积会随上游镜像的字面版本变化，前端这份只是**兜底**，不要拿它做校验。
 */
export const BUILTIN_FONT_SIZE = 33_493_260;

/** 自定义简历字体（R10）：只影响 PDF 导出用的字体。 */
export interface ResumeFont {
  /** 磁盘上的真实文件名；`format_config.font` 存的就是它。 */
  name: string;
  /** 用户可改的展示名，没改过时等于文件名去扩展名。 */
  display_name: string;
  size: number;
  uploaded_at: string;
  active: boolean;
  /**
   * 应用**自带清单**里的条目（当前只有思源黑体）。它固定排在第 1 位，用户删不掉。
   * 老后端没有这个字段，所以是可选的：`undefined` 与 `false` 都按"用户导入的字体"处理。
   */
  builtin?: boolean;
  /**
   * 内置条目是否**已经下载到本机**。`false` 时磁盘上还没有这个文件，选中它没有意义
   * （预览/导出的 `@font-face` 会 404），界面必须把它标成「未下载」。
   */
  downloaded?: boolean;
}

export interface ResumeFonts {
  items: ResumeFont[];
  active: string | null;
  max_bytes: number;
}

/**
 * 内置字体的下载状态（`state` 是唯一的状态源，`downloaded` 只是它的派生快照）。
 *
 * `POST .../builtin/download` 是**异步启动**（202 立即返回 `state="downloading"`），
 * 进度靠轮询 `GET .../builtin` 读 `downloaded_bytes / total_bytes`。
 */
export interface BuiltinFontStatus {
  /** 稳定标识（`source-han-sans-sc`）；文件名用 `BUILTIN_FONT_FILE`，不要拿它当文件名。 */
  id: string;
  /** 界面上显示的名字（「思源黑体」）。 */
  label: string;
  /** 字体总字节数（未下载时也拿得到，用来显示"约 32 MB"）。 */
  size_total: number;
  downloaded: boolean;
  /** 已下载字节数（轮询进度用，`state="downloading"` 时才有意义）。 */
  downloaded_bytes: number;
  /** 进度分母；后端拿不到时会是 0，此时界面只显示已下载量。 */
  total_bytes: number;
  state: "idle" | "downloading" | "failed" | "done";
  /** 失败原因（`state="failed"` 时给中文人话），其它状态为空串。 */
  error: string;
  /**
   * **新增可选**：`true` = 取消信号已发出、下载线程在收尾（状态仍是 `downloading`）。
   *
   * 只给日志与"正在取消…"这句提示用。**不得**当独立状态判断——收尾完成后 `state` 才会
   * 变成 `idle`；旧后端不返回该字段时按 `false` 处理。
   */
  cancelling?: boolean;
}

/** 字体清单（含内置条目与"哪一个是当前字体"）。 */
export function listResumeFonts(): Promise<ResumeFonts> {
  return request("/settings/fonts");
}

/**
 * 字体清单的**别名**。
 *
 * 与 `listResumeFonts` 是同一个请求、同一个承诺：本批新增的调用点（字体下拉、样张弹窗）
 * 用这个名字读起来更直白，既有调用点保持原样。**不要再写第三份实现。**
 */
export function getResumeFonts(): Promise<ResumeFonts> {
  return listResumeFonts();
}

/** 任意已上传字体的原始文件 URL（设置页点击预览用；同源相对路径，开发态走 Vite 代理）。 */
export function resumeFontPreviewUrl(name: string): string {
  return `/api/settings/fonts/${encodeURIComponent(name)}/file`;
}

/**
 * **已下线：`POST /settings/fonts` 现在返回 405。**
 *
 * 字体上传入口在 2026-11 一并撤掉（体积与授权责任改由应用统一承担，用户侧只剩"内置思源
 * 黑体按需下载"与"历史导入字体"两条路）。这个函数**没有任何调用点**，留着只是为了不
 * 打断既有的 import 与测试夹具；**不要把它接回界面**——真接回去只会得到 405。
 * 要恢复上传能力，得先在后端把端点加回来，再删掉这段注释。
 */
export function uploadResumeFont(file: File): Promise<ResumeFont> {
  const form = new FormData();
  form.append("file", file);
  // 字体最大 30MB：走上传预算，不吃 15s 的默认超时。
  return request("/settings/fonts", { method: "POST", body: form, budget: "upload" });
}

/** 设为当前字体；`null` = 回到系统字体。 */
export function activateResumeFont(name: string | null): Promise<{ active: string | null }> {
  return request("/settings/fonts/active", {
    method: "PUT",
    body: JSON.stringify({ name }),
  });
}

/** 改字体的展示名（文件名不变，已引用它的简历不受影响）。 */
export function renameResumeFont(name: string, displayName: string): Promise<ResumeFont> {
  return request(`/settings/fonts/${encodeURIComponent(name)}`, {
    method: "PATCH",
    body: JSON.stringify({ display_name: displayName }),
  });
}

/** 删除一份历史导入的字体（直删，没有回收站；调用方负责二次确认）。 */
export function deleteResumeFont(name: string): Promise<void> {
  return request(`/settings/fonts/${encodeURIComponent(name)}`, { method: "DELETE" });
}

/**
 * 内置字体当前状态。轮询也用它——**只读**，不会重试或触发下载。
 *
 * 与 `listResumeFonts` 分开是刻意的：字体清单是"有哪些字体可用"，状态是"那个大文件下到哪了"。
 * 把它塞进清单会让每次轮询都重读一遍字体目录。
 */
export function getBuiltinFont(): Promise<BuiltinFontStatus> {
  return request("/settings/fonts/builtin");
}

/**
 * 启动下载（202）。重复调用在 `state="downloading"` 时后端回 409「字体正在下载中」，
 * 磁盘写不进去回 507「磁盘空间不足，无法保存字体」——两条错误都要原样透传给用户。
 *
 * `options.activate`（**可选**，缺省不带该查询参数 = 后端默认 `true`）：
 * - `true` → 下载完成后把它设为**全局**当前字体（设置页那条路径，与今天逐字一致）；
 * - `false` → 只把文件落地，不动全局字体。简历制作台的字体下拉走这一条：那里下载出来的
 *   字体要成为**这一份简历**的字体，改全局设置属于另一件事（用户没点过"设为当前"）。
 */
export function startBuiltinFontDownload(
  options: { activate?: boolean } = {},
): Promise<BuiltinFontStatus> {
  const query =
    options.activate === undefined ? "" : `?activate=${options.activate ? "true" : "false"}`;
  return request(`/settings/fonts/builtin/download${query}`, { method: "POST" });
}

/**
 * 取消正在进行的下载（200 + 与 `GET .../builtin` 同构的状态）。
 *
 * **幂等**：没有下载在跑时原样返回当前状态（不 404、不 409）。所以"点取消的那一刻刚好下完"
 * 的结果是 `state="done"` + 文件保留——以完成为准，前端据此显示"已下载"而不是"已取消"。
 * 取消**不改**当前字体；本轮写下的临时文件与已落地的文件由后端清掉。
 */
export function cancelBuiltinFontDownload(): Promise<BuiltinFontStatus> {
  return request("/settings/fonts/builtin/download/cancel", { method: "POST" });
}

/**
 * 删除已下载的内置字体文件（两款字重一起删）。
 *
 * 状态口径（调用方按它决定提示什么）：
 * - **204** → 删除成功。若删的正是当前字体，后端已把 `active` 置空，前端要提示
 *   「已删除，简历字体已回到系统字体」；
 * - **404** → 本来就没下载（幂等视角下等于"已经没有了"）。调用方可以当作成功继续刷新清单，
 *   不必弹错误；
 * - **409** → 正在下载中，什么都没删。前端本该隐藏入口，走到这里是"另一个窗口"那条路；
 * - **500** → 文件被占用/无权限，文件原样留着，`detail` 里是原因。
 *
 * 直删、没有回收站：接到界面上时确认正文必须写明这一点。
 */
export function deleteBuiltinFont(): Promise<void> {
  return request("/settings/fonts/builtin", { method: "DELETE" });
}
