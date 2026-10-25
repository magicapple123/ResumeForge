// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心「AI 生成」入口的模块级信号（模式同 features/shortcuts/runtimeTargets）。
 *
 * 为什么需要它：两个入口分处两行（筛选栏的按钮、下方场景建议卡的按钮），而生成弹窗
 * 只能有一个实例、只有一份打开状态。让弹窗组件持有状态并在这里登记"打开"信号，
 * 两个按钮都只调 trigger——不复制弹窗、不引入新的全局 store。
 */
type OpenHandler = () => void;

let openHandler: OpenHandler | null = null;

export function registerResumeCenterAiGenerateHandler(handler: OpenHandler | null): void {
  openHandler = handler;
}

/** 打开通用简历的 AI 生成弹窗；入口组件没挂载时是无操作（不报错）。 */
export function triggerResumeCenterAiGenerate(): void {
  openHandler?.();
}
