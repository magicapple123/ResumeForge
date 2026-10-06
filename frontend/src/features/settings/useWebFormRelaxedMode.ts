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

  const reload = useCallback(async () => {
    try {
      setEnabled((await getWebFormRelaxedMode()).enabled);
    } catch {
      // 读不到按默认关处理：放宽模式是加动作的开关，保守显示比假装开着安全。
      setEnabled(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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
