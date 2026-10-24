// SPDX-License-Identifier: Apache-2.0
/** 内存 Storage 夹具：专业视图的偏好/最近使用/裁剪桥都允许注入 storage 以便离线测试。 */
import type { StorageLike } from "../features/resume-proview/preferences";

export interface MemoryStorage extends StorageLike {
  data: Map<string, string>;
}

export function createMemoryStorage(initial: Record<string, string> = {}): MemoryStorage {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}
