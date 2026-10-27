// SPDX-License-Identifier: Apache-2.0
/**
 * 列表默认只展示前 `limit` 条的折叠开关（设置页数据集/手动备份/助手技能共用）。
 *
 * 纯展示层折叠：接口照常拉全量，这里只截取渲染条目；「显示全部 N 条」展开后
 * 可再收起。条目不超过 limit 时不渲染按钮（toggleNode 为 null）。
 */
import { Button } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export function useCollapsedList<T>(items: T[], limit = 5) {
  // 本 hook 的折叠按钮文案必须随语言更新，而消费方组件不在本批清单内：
  // 在 hook 内订阅一次，调用方渲染时就会跟着重新执行（无需各自加 useLocale）。
  useLocale();
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
          {expanded
            ? t("common.collapsedList.collapse")
            : t("common.collapsedList.expand", { count: items.length })}
        </Button>
      ) : null,
  };
}
