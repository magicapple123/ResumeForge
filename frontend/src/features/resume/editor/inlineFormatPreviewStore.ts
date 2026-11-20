// SPDX-License-Identifier: Apache-2.0
/**
 * 「未编辑时预览行内格式」开关的**模块级单例**（照 `utils/navigationVisibility`）。
 *
 * 为什么不是一个 hook + 每个字段各发一次请求：制作台同屏可能有几十个值输入框，
 * 逐个 `GET /settings/inline-format-preview` 会在打开一条简历时打出一串重复请求。
 * 这里 `load()` 全进程只发一次（进行中复用同一个 promise），失败保持默认 `false` ——
 * 预览是增强项，读不到就退回旧行为，不弹错、不阻塞编辑器。
 *
 * 写走乐观更新：`set()` 先改本地再落库，失败回滚。开关是"点下去就该立刻变"的交互，
 * 等一个往返再变色会让人以为没点上。
 */
import { getInlineFormatPreview, saveInlineFormatPreview } from "../../../api/settings";

type Listener = () => void;

let enabled = false;
let loaded = false;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** `useSyncExternalStore` 的快照：必须是稳定原始值，不能每次新建对象。 */
export function isInlineFormatPreviewEnabled(): boolean {
  return enabled;
}

export function subscribeInlineFormatPreview(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 供测试与设置卡直接发布状态（去重后通知）。 */
export function publishInlineFormatPreview(next: boolean): void {
  if (next === enabled) return;
  enabled = next;
  emit();
}

export function loadInlineFormatPreview(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = getInlineFormatPreview()
    .then((config) => publishInlineFormatPreview(config.enabled))
    .catch(() => undefined)
    .finally(() => {
      loaded = true;
      loadPromise = null;
      emit();
    });
  return loadPromise;
}

/**
 * 乐观写入：先发布，失败回滚到上一值并**把错误抛给调用方**（开关自己弹提示）。
 * 不在这里吞掉异常——设置卡需要知道"没存上"。
 */
export async function setInlineFormatPreview(next: boolean): Promise<void> {
  const previous = enabled;
  publishInlineFormatPreview(next);
  try {
    const saved = await saveInlineFormatPreview(next);
    publishInlineFormatPreview(saved.enabled);
  } catch (error) {
    publishInlineFormatPreview(previous);
    throw error;
  }
}

/** 测试专用：把模块状态清回"未加载 + 关"。 */
export function resetInlineFormatPreviewForTests(): void {
  enabled = false;
  loaded = false;
  loadPromise = null;
  emit();
}
