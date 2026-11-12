// SPDX-License-Identifier: Apache-2.0
/**
 * 读话术模板清单（#14D）：编辑器的「从模板选择」与批量套用共用这一份读取逻辑。
 *
 * 只读、无缓存：模板在设置弹窗里改完就回队列，两份调用点各自取自己的，不共享全局单例
 * （全局缓存会让"刚保存的模板在编辑弹窗里看不到"）。
 */
import { getGreetingTemplates } from "../../../api/applyExtras";
import { useApi } from "../../../hooks/useApi";
import type { GreetingTemplate, GreetingTemplateList } from "../../../types";

export function useGreetingTemplates(): {
  templates: GreetingTemplate[];
  loading: boolean;
  error: string;
} {
  const { data, loading, error } = useApi<GreetingTemplateList>(getGreetingTemplates, []);
  return { templates: data?.templates ?? [], loading, error };
}
