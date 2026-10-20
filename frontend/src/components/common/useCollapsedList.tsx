// SPDX-License-Identifier: Apache-2.0
/**
 * 列表默认只展示前 `limit` 条的折叠开关（设置页数据集/手动备份/助手技能共用）。
 *
 * 纯展示层折叠：接口照常拉全量，这里只截取渲染条目；「显示全部 N 条」展开后
 * 可再收起。条目不超过 limit 时不渲染按钮（toggleNode 为 null）。
 */
import { Button } from "antd";
import { useState } from "react";

export function useCollapsedList<T>(items: T[], limit = 5) {
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = Math.max(0, items.length - limit);
  return {
    visibleItems: expanded ? items : items.slice(0, limit),
    hiddenCount,
    toggleNode:
      hiddenCount > 0 ? (
        <Button
          type="link"
          size="small"
          style={{ paddingInline: 0, marginTop: 4 }}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "收起列表" : `显示全部 ${items.length} 条`}
        </Button>
      ) : null,
  };
}
