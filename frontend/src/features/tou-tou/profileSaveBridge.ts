// 简历资料编辑页与投投悬浮球之间的保存动作桥。
// 页面侧：表单变为脏时调用 setProfileSaveControl(...)，保存/取消后传 null 收起。
// 悬浮球侧：订阅该控制块，在球旁渲染「保存资料 / 取消」浮动按钮。
// 该模块刻意不依赖 React，方便页面组件在 effect 中同步状态。

export interface ProfileSaveControl {
  /** 触发页面既有的保存逻辑（含校验与提示） */
  onSave: () => void;
  /** 触发页面既有的取消/重置逻辑 */
  onCancel: () => void;
  /** 保存请求进行中时置 true，悬浮球按钮进入加载态 */
  saving?: boolean;
}

type Listener = () => void;

let current: ProfileSaveControl | null = null;
const listeners = new Set<Listener>();

export function setProfileSaveControl(control: ProfileSaveControl | null): void {
  current = control;
  listeners.forEach((listener) => listener());
}

export function getProfileSaveControl(): ProfileSaveControl | null {
  return current;
}

export function subscribeProfileSaveControl(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
