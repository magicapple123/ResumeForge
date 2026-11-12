// SPDX-License-Identifier: Apache-2.0
/**
 * 批量操作参数的读取（设置页两张卡与「本次参数」弹窗共用的**唯一读入口**）。
 *
 * 两套参数各自判断：批量生成看 `generation`，批量导出看 `export`。动作在**点击时**
 * 重新读一次——用户很可能刚在设置里改完就切回来，缓存一份"没配置"只会让他再点一次。
 *
 * 这里不再有「必须先配置」的守卫：触发点改成直接弹「本次参数」弹窗（见
 * `features/batch/BatchConfigModal`），未配置时用默认值开局即可。真正的拒绝仍在后端
 * （既没传本次参数、全局也没配置时，批量导出接口返回 409）。
 */
import { useCallback, useState } from "react";
import { getBatchOperationConfig, type BatchOperationConfigOut } from "../../api/settingsBatch";

export function useBatchOperationConfig() {
  const [data, setData] = useState<BatchOperationConfigOut | null>(null);

  const refresh = useCallback(async (): Promise<BatchOperationConfigOut | null> => {
    try {
      const next = await getBatchOperationConfig();
      setData(next);
      return next;
    } catch {
      // 读不到（老后端 / 临时故障）按"未配置"处理：弹窗会用默认值开局并说明，
      // 而不是把一次本来能跑的动作拦死在门口。
      setData(null);
      return null;
    }
  }, []);

  return { data, refresh };
}
