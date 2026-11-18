// SPDX-License-Identifier: Apache-2.0
/**
 * 实时探针的**出口登记处**（I-15）。
 *
 * ## 为什么需要它
 *
 * 拖动字号 / 行距 / 照片框时，纸面的逐帧反馈靠 `ResumePreviewHandle.setLiveProbe` 直接往
 * 预览 iframe 里写一条 `<style>`。但 `ObjectStylePanel` 有两个宿主：
 * - 左栏排版参数（`WorkbenchParamsTab`）——一直有 `previewRef`；
 * - 字段右键「调整排版」浮层（`ChipStylePopover`）与「照片框…」浮层——宿主没有 ref 通道。
 *
 * 后两者不接探针 = 拖动时纸面纹丝不动，只能等 600ms 合并 + 服务端重排（本条的现象）。
 * 为了不把 `previewRef` 一层层穿过工作台（那条链路正被别的条目改），这里登记"当前活着的
 * 预览"：没有 `previewRef` 的宿主回落到它，行为与显式 ref 完全相同。
 *
 * ## 语义
 *
 * - 多个预览同时挂载（制作台右栏 + 同页预览弹窗）时**全部**收到同一条 CSS：每个预览各自
 *   往自己的 iframe 写一条探针，互不影响；
 * - 写空串 = 清探针（与 `setLiveProbe("")` 同义）；
 * - 没有登记任何预览时返回 `false`，调用方据此决定"这次没有实时反馈"（不静默成功）。
 */
type ProbeWriter = (css: string) => void;

const writers = new Set<ProbeWriter>();

/** 登记一个预览（返回注销函数，卸载时必须调用）。 */
export function registerLiveProbe(writer: ProbeWriter): () => void {
  writers.add(writer);
  return () => {
    writers.delete(writer);
  };
}

/** 向所有活着的预览写探针；至少命中一个返回 `true`。 */
export function writeLiveProbe(css: string): boolean {
  for (const writer of writers) writer(css);
  return writers.size > 0;
}
