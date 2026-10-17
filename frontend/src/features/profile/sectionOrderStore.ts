/**
 * 资料分区排序的顺序 store（模块级工厂 + `useSyncExternalStore` 协议）。
 *
 * 从 `useProfileSectionReorder.ts` 拆出：顺序与拖拽态的存取和广播是自包含的
 * 一小块（普通闭包变量 + 监听器集合，不走 React ref/state），钩子只负责指针
 * 行为。`getSnapshot` 返回缓存快照（只在 commit 时换新对象），满足
 * `useSyncExternalStore` 的引用稳定性要求；编译器视角这是纯外部可变量，正是
 * 该协议的标准形态。
 */
import {
  DEFAULT_SECTION_ORDER,
  type ProfileSectionKey,
} from "../../components/profile/ProfileSectionConfig";

/** store 快照：顺序 + 拖拽态（拖拽态要给分区壳加 `is-section-reordering` / `is-dragging`）。 */
export interface ProfileSectionOrderSnapshot {
  sectionOrder: ProfileSectionKey[];
  reordering: boolean;
  /** 正在被拖的分区（null=无拖拽）。抬起视觉由 React 声明式挂类，不靠命令式补类。 */
  draggingKey: ProfileSectionKey | null;
}

/** `useSyncExternalStore` 协议：快照引用只在 commit 时更换，两次 commit 间恒定。 */
export interface ProfileSectionOrderStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ProfileSectionOrderSnapshot;
  /** 事件时刻读最新顺序（提交/解析等不经渲染的消费口）。 */
  getOrder: () => ProfileSectionKey[];
  /** 整体换序（拖拽实时 splice 与加载资料写入共用此出口）。 */
  commitOrder: (next: ProfileSectionKey[]) => void;
  setReordering: (value: boolean) => void;
  /** 进入拖拽：一次 notify 同时打开 reordering 与 draggingKey（避免两次重渲）。 */
  beginDrag: (sectionKey: ProfileSectionKey) => void;
  /** 结束拖拽：一次 notify 同时关闭 reordering 与 draggingKey。 */
  endDrag: () => void;
}

export function createSectionOrderStore(): ProfileSectionOrderStore {
  let order: ProfileSectionKey[] = DEFAULT_SECTION_ORDER;
  let reordering = false;
  let draggingKey: ProfileSectionKey | null = null;
  let snapshot: ProfileSectionOrderSnapshot = { sectionOrder: order, reordering, draggingKey };
  const listeners = new Set<() => void>();
  const notify = () => {
    snapshot = { sectionOrder: order, reordering, draggingKey };
    listeners.forEach((listener) => listener());
  };
  const setDragState = (nextReordering: boolean, nextKey: ProfileSectionKey | null) => {
    if (nextReordering === reordering && nextKey === draggingKey) return;
    reordering = nextReordering;
    draggingKey = nextKey;
    notify();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    getOrder: () => order,
    /** 顺序写入的唯一出口：先同步换变量（事件回调立刻可读），再广播订阅者。 */
    commitOrder(next) {
      if (next === order) return;
      order = next;
      notify();
    },
    setReordering(value) {
      setDragState(value, value ? draggingKey : null);
    },
    beginDrag(sectionKey) {
      setDragState(true, sectionKey);
    },
    endDrag() {
      setDragState(false, null);
    },
  };
}
