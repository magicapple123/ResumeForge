// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { layer } from "./tokens";

/**
 * antd 6 useZIndex 的容器链数学（node_modules/antd/es/_util/hooks/useZIndex.js）：
 * 单层 Modal/Drawer = zIndexPopupBase + 100（容器偏移），且 Drawer 经
 * ZIndexContext 把自己的值传给内部 Modal 再 +100/层。message/notification 不走
 * useZIndex，分别落在 popupBase + 1000 + 10 / + 50（见两组件 style/index.js）。
 * 这组常量是断言的依据，antd 升级若改变该数学，这里会先红。
 */
const ANT_CONTAINER_OFFSET = 100;
const ANT_MESSAGE_OFFSET = 1010;
const ANT_NOTIFICATION_OFFSET = 1050;

describe("弹层层级梯度", () => {
  it("投投整族严格递增：Modal 基准 < 助手卡 < 保存卡 < 剪贴板卡 < 卡内弹层 < 球 < tip", () => {
    const {
      popupBase,
      editorModal,
      assistantCard,
      saveCard,
      clipboardCard,
      cardPopup,
      orb,
      orbTooltip,
    } = layer;
    expect(popupBase).toBeLessThan(editorModal);
    expect(editorModal).toBeLessThan(assistantCard);
    expect(assistantCard).toBeLessThan(saveCard);
    expect(saveCard).toBeLessThan(clipboardCard);
    expect(clipboardCard).toBeLessThan(cardPopup);
    expect(cardPopup).toBeLessThan(orb);
    expect(orb).toBeLessThan(orbTooltip);
  });

  it("剪贴板卡压在助手卡之上：两卡同开时剪贴板不能被大尺寸的助手卡盖住", () => {
    expect(layer.clipboardCard).toBeGreaterThan(layer.assistantCard);
  });

  it("卡内弹层基准加上 antd 组件偏移（下拉 +50、预览 +80）仍在剪贴板卡之上、悬浮球之下", () => {
    expect(layer.cardPopup + 50).toBeGreaterThan(layer.clipboardCard);
    expect(layer.cardPopup + 80).toBeLessThan(layer.orb);
  });

  // 回归（2026-10 用户截图）：岗位广场 Drawer 内的详情 Modal 实际 z =
  // popupBase + 200（3300），与旧 clipboardCard（3300）同值，Modal 门户挂到
  // body 末尾按 DOM 顺序胜出，把三卡的下部盖住。以下断言把"容器链必须低于
  // 投投三卡"钉死，防止未来调层时退回去。
  it("antd 6 容器链（单层/嵌套 Modal、Drawer）都盖不住助手卡与剪贴板卡", () => {
    // 单层 Modal/Drawer 实际 3200：低于助手卡。
    expect(layer.popupBase + ANT_CONTAINER_OFFSET).toBeLessThan(layer.assistantCard);
    // Drawer 内嵌 Modal 实际 3300（用户截图的肇事值）：仍低于助手卡。
    expect(layer.popupBase + ANT_CONTAINER_OFFSET * 2).toBeLessThan(layer.assistantCard);
    // 病态三层容器链 3400：也要低于剪贴板卡（助手卡只承诺两层内的嵌套）。
    expect(layer.popupBase + ANT_CONTAINER_OFFSET * 3).toBeLessThan(layer.clipboardCard);
  });

  it("message/notification（popupBase+1010/+1050）仍在投投族之上：toast 不被卡片遮挡", () => {
    expect(layer.orbTooltip).toBeLessThan(layer.popupBase + ANT_MESSAGE_OFFSET);
    expect(layer.popupBase + ANT_NOTIFICATION_OFFSET).toBeGreaterThan(layer.orbTooltip);
  });
});
