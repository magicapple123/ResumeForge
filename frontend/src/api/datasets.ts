// SPDX-License-Identifier: Apache-2.0
/**
 * 数据集的增删改查（列表 / 新建 / 载入示例 / 导入包 / 激活 / 改名 / 删除）。
 *
 * 从 `api/settings.ts` 拆出：那个文件加完行内格式预览的端点后到了 **508 行**，
 * 贴着 500 行硬预算。这里只搬走"一次性数据操作"这一组，**路径、方法、超时预算一字未改**，
 * 并在 `settings.ts` 里原样转发，所以既有 `import { listDatasets } from "../api/settings"`
 * 的调用点一个都不用动（与 `datasetArchive.ts` 同一处置方式）。
 *
 * 不放进 `datasetArchive.ts`：那个模块只管"备份包的导出与包内范围解析"，把写操作混进去
 * 会让"只读归档"和"会改当前数据集"的代码长在一个文件里。
 */
import { request } from "./client";
import type { DatasetImportResult, DatasetInfo } from "../types";

export function listDatasets(): Promise<DatasetInfo[]> {
  return request("/settings/datasets");
}

/** 新建一份空数据集（自定义名称，≤64 字），返回描述；创建后可激活。 */
export function createDataset(name: string): Promise<DatasetInfo> {
  return request("/settings/datasets", { method: "POST", body: JSON.stringify({ name }) });
}

/**
 * 一键载入体验示例：新建「体验示例」数据集、写入纯虚构数据并切换过去。
 * 主数据不受影响；写完由调用方刷新页面让全部视图落到新数据集上。
 *
 * 后端在已存在「体验示例」数据集时会**复用**而不是再建一份，并返回
 * `reused: true`（旧后端没有这个字段，可选以容忍）——调用方据此把提示
 * 从"已创建/已就绪"改成分流的措辞，避免重复点击时谎报又建了一份。
 */
export function loadSampleDataset(): Promise<DatasetInfo & { reused?: boolean }> {
  return request("/settings/datasets/sample/load", { method: "POST" });
}

/** 把备份包导入为一份**新数据集**；不触碰当前正在使用的数据。 */
export async function importDataset(
  file: File,
  name: string,
  /** 显式选择"跳过有问题的附件继续导入"（默认 false：附件有问题时整次导入被拒绝）。 */
  allowPartialAssets = false,
): Promise<DatasetImportResult> {
  const partial = allowPartialAssets ? "&allow_partial_assets=true" : "";
  return request(`/settings/datasets/import?name=${encodeURIComponent(name)}${partial}`, {
    method: "POST",
    // 必须写死 application/zip：浏览器按系统映射给出的 File.type 不可靠，而这个
    // 类型不在 CORS 简单请求允许的范围内，跨站页面无法直接触发导入流程。
    headers: { "Content-Type": "application/zip" },
    body: file,
    // 备份包可能几十 MB，走 upload 预算（10 分钟），不吃 15s 的默认超时。
    budget: "upload",
  });
}

export function activateDataset(id: string): Promise<DatasetInfo> {
  // 切换要等后端排空（上限 10s）再跑两次元数据迁移：default 的 15s 会把"快成功"的
  // 切换掐成客户端超时，而服务端此时已经切完了——下次写请求就拿着旧 token 吃 409。
  return request(`/settings/datasets/${id}/activate`, { method: "POST", budget: "task" });
}

export function renameDataset(id: string, name: string): Promise<DatasetInfo> {
  return request(`/settings/datasets/${id}?name=${encodeURIComponent(name)}`, { method: "PATCH" });
}

export function deleteDataset(id: string): Promise<void> {
  return request(`/settings/datasets/${id}`, { method: "DELETE" });
}
