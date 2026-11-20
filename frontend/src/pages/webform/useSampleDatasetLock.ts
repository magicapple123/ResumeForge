// SPDX-License-Identifier: Apache-2.0
/**
 * 当前数据集是不是「体验示例」（`source === "sample"`）。
 *
 * 示例数据是纯虚构的演示内容：它让新用户每个页面都有东西可看，但**不参与真实填表**。
 * 后端在 `live/start` 与 `preview` 上已经返回 409（见 `services/webform/dataset_guard.py`），
 * 这里只是让按钮提前灰掉并写明原因——用户不该点下去才知道不行。
 *
 * 页头（AppHeaderContext）也自己拉 `/api/settings/datasets`，但它的状态不落全局；为了
 * 不在页头之外再复制一份"当前数据集"的来源，这里按需取一次列表、只取 `is_active` 的
 * 那份的 `source`。读失败**不拦**（详情见 catch 里的注释）。
 */
import { useEffect, useState } from "react";
import { listDatasets } from "../../api/settings";

export function useSampleDatasetLock(): boolean {
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listDatasets()
      .then((items) => {
        if (cancelled) return;
        const active = items.find((item) => item.is_active);
        setLocked(active?.source === "sample");
      })
      .catch(() => {
        // 数据集列表读不到（后端刚重启等）时按"不拦"处理：后端 409 仍是最终防线，
        // 界面不该因为一次读失败就把功能整块锁死。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return locked;
}
