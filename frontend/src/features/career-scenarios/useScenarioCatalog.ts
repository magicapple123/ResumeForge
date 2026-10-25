// SPDX-License-Identifier: Apache-2.0
/** 内置场景目录（8 个快捷场景 + 限额）：失败不阻断旧生成流程，重试入口由调用方给。 */
import { useApi } from "../../hooks/useApi";
import { fetchCareerScenarioCatalog } from "./api";
import type { CareerScenarioCatalog } from "./types";

export interface ScenarioCatalogState {
  catalog: CareerScenarioCatalog | null;
  loading: boolean;
  /** 加载失败的原始文案；空串 = 没有错误。 */
  error: string;
  reload: () => Promise<void>;
}

/**
 * 只在 `open` 为真时请求目录（弹窗/区块打开才加载），关闭时立刻回到空态。
 * 失败由调用方降级：快捷场景不可选，但已保存场景与旧生成流程照常。
 */
export function useScenarioCatalog(open: boolean): ScenarioCatalogState {
  const { data, loading, error, reload } = useApi<CareerScenarioCatalog | null>(
    () => (open ? fetchCareerScenarioCatalog() : Promise.resolve(null)),
    [open],
  );
  return { catalog: data ?? null, loading, error, reload };
}
