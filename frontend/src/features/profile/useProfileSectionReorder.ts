// SPDX-License-Identifier: Apache-2.0
/**
 * 资料分区排序状态入口（T05 重写；order 外部 store 化）。
 *
 * 拖拽会话（指针几何/实时换位/自动滚动）已拆到 `profileSectionDragSession.ts`；
 * 本文件只负责：store 单例、把编辑态门禁传给会话、以及对外的稳定 API（ProfilePage /
 * ProfileSectionStack 依赖这些引用稳定，回调换新会把 memo 打穿）。
 *
 * 顺序住在模块级 store 里而不是页面级 React state：拖拽中的每次 splice 只重渲订阅它的
 * `ProfileSectionStack`，antd Form 子树整块跳过（历史上页面级 state 让 67 个 Form.Item
 * 在每次换位时全量重渲，单次实测 170ms）。
 */
import { useCallback, useState } from "react";
import type { RefObject } from "react";
import type { ProfileSectionKey } from "../../components/profile/ProfileSectionConfig";
import { useProfileSectionDragSession } from "./profileSectionDragSession";
import { stepSectionOrder } from "./profileSectionMove";
import { createSectionOrderStore } from "./sectionOrderStore";

interface Options {
  editing: boolean;
  saving: boolean;
  photoReading: boolean;
}

export function useProfileSectionReorder({ editing, saving, photoReading }: Options) {
  // store 单例：useState 惰性初始化，组件生命周期内引用恒定（跨重渲保持监听器）。
  const [store] = useState(createSectionOrderStore);
  const session = useProfileSectionDragSession({ store, editing, saving, photoReading });

  // 上移/下移一位：实现与焦点收尾见 `profileSectionMove.ts`（键盘与微调按钮同一条路径）。
  const moveSectionByOffset = useCallback(
    (sectionKey: ProfileSectionKey, offset: -1 | 1) => stepSectionOrder(store, sectionKey, offset),
    [store],
  );

  return {
    /** 顺序 + 排序模式的外部 store（ProfileSectionStack 用 useSyncExternalStore 订阅）。 */
    sectionOrderStore: store,
    /** 事件时刻读最新顺序（提交/解析等不经渲染的消费口）。 */
    getSectionOrder: store.getOrder,
    /** 整体换序（加载资料时写入服务端保存的顺序）。 */
    setSectionOrder: store.commitOrder,
    sectionReorderMode: session.sectionReorderMode,
    setSectionReorderMode: session.setSectionReorderMode,
    resetSectionReorder: session.resetSectionReorder,
    handleSectionPointerDown: session.handleSectionPointerDown,
    moveSectionByOffset,
  };
}

/** 测试/调试用的计数器形状：分区内容与分区栈的渲染次数各一个可变槽。 */
export interface ReorderRenderCounters {
  contentRenders: RefObject<number>;
  commits: RefObject<number>;
}
