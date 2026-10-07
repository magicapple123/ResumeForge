/**
 * 网申填表「放宽模式」开关的取数与保存。
 *
 * 后端持久化（app_setting，默认关），预览页快捷入口与设置页卡片共用同一份状态，
 * 两处切换的即时反映靠「切换后各自重拉一次」——设置项没有跨页广播，代价是一次
 * 请求，换来的是两处状态永远不会各说各话。
 */
import { useCallback, useEffect, useState } from "react";
import { getWebFormRelaxedMode, saveWebFormRelaxedMode } from "../../api/settings";

export function useWebFormRelaxedMode() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 纯取数（不含 setState）：effect 与事件路径共用同一实现，避免两份加载逻辑漂移。
  const fetchEnabled = useCallback(async (): Promise<boolean> => {
    try {
      return (await getWebFormRelaxedMode()).enabled;
    } catch {
      // 读不到按默认关处理：放宽模式是加动作的开关，保守显示比假装开着安全。
      return false;
    }
  }, []);

  // Compiler 规范：setState 放在 .then 回调里（外部数据到达时应用），而非 effect 体。
  useEffect(() => {
    let cancelled = false;
    void fetchEnabled().then((value) => {
      if (cancelled) return;
      setEnabled(value);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchEnabled]);

  // 事件路径（切换后重拉）：由消费方在事件处理器中调用，不走 effect。
  const reload = useCallback(async () => {
    setEnabled(await fetchEnabled());
    setLoading(false);
  }, [fetchEnabled]);

  const toggle = useCallback(
    async (checked: boolean): Promise<boolean> => {
      if (saving) return false;
      setSaving(true);
      setEnabled(checked);
      try {
        const saved = await saveWebFormRelaxedMode(checked);
        setEnabled(saved.enabled);
        return saved.enabled;
      } catch {
        // 保存失败回滚到切换前的状态。
        setEnabled(!checked);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [saving],
  );

  return { enabled, loading, saving, toggle, reload };
}
