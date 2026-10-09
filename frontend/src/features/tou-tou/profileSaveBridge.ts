// 简历资料编辑页与投投悬浮球之间的动作桥。
// 页面侧：条件成立时注册控制块，条件消失时传 null 收起——
//   · 表单变为脏 → 「保存资料 / 取消」浮卡（setProfileSaveControl）；
//   · 停在「我的资料」且未编辑 → 「去改资料」提示卡（setProfileEditControl）。
// 悬浮球侧：订阅对应槽位，在球旁渲染卡片。
// 该模块刻意不依赖 React，方便页面组件在 effect 中同步状态。

export interface ProfileSaveControl {
  /** 触发页面既有的保存逻辑（含校验与提示） */
  onSave: () => void;
  /** 触发页面既有的取消/重置逻辑 */
  onCancel: () => void;
  /** 保存请求进行中时置 true，悬浮球按钮进入加载态 */
  saving?: boolean;
}

export interface ProfileEditControl {
  /** 触发页面既有的「进入编辑态」逻辑 */
  onEdit: () => void;
  /** 用户关掉这张提示卡；本次停留在「我的资料」期间不再出现 */
  onDismiss: () => void;
}

type Listener = () => void;

/**
 * 一个动作槽位：模块级单例 + 一组订阅者。
 *
 * 两个动作各占一个槽，互不干扰——否则一边注册/注销会把另一边的订阅者也唤醒。
 * `get` 必须返回**同一个引用**直到下次 `set`：它同时是 `useSyncExternalStore` 的快照，
 * 每次现构造对象会让 React 判定快照不稳定而反复重渲。
 */
function createControlSlot<T>() {
  let current: T | null = null;
  const listeners = new Set<Listener>();
  return {
    set(control: T | null): void {
      current = control;
      listeners.forEach((listener) => listener());
    },
    get(): T | null {
      return current;
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const saveSlot = createControlSlot<ProfileSaveControl>();
const editSlot = createControlSlot<ProfileEditControl>();

export function setProfileSaveControl(control: ProfileSaveControl | null): void {
  saveSlot.set(control);
}

export function getProfileSaveControl(): ProfileSaveControl | null {
  return saveSlot.get();
}

export function subscribeProfileSaveControl(listener: Listener): () => void {
  return saveSlot.subscribe(listener);
}

export function setProfileEditControl(control: ProfileEditControl | null): void {
  editSlot.set(control);
}

export function getProfileEditControl(): ProfileEditControl | null {
  return editSlot.get();
}

export function subscribeProfileEditControl(listener: Listener): () => void {
  return editSlot.subscribe(listener);
}
