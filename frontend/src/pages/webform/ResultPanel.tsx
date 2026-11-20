// SPDX-License-Identifier: Apache-2.0
/**
 * 结果区：把「预览与填充 / 待补资料 / 填充结果」三块合成一组 Tabs。
 *
 * 原来这三块各占一张平级 Card（最多时一屏九张卡），"我刚填完，结果在哪"要靠肉眼找。
 * 合并后只有一处结果区，标签上的数字直接说清「还有几项要你补」。
 *
 * 三条约定：
 *  1. **没有预览也没有结果时整块不渲染**——空壳卡片只会占掉首屏；
 *  2. 三个 pane 全部 `forceRender`：切走不销毁。待补资料里的「没认出来」是折叠面板，
 *     一旦被卸载，用户切回来看到的就是回到收起态，勾选和展开状态全丢；
 *  3. 填充完成后自动落到「填充结果」（派生值，不写 state），用户手动点过标签之后
 *     就尊重他的选择，不再抢焦点。
 */
import { Tabs } from "antd";
import type { TabsProps } from "antd";
import { useState } from "react";
import type { ReactNode } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { WebFormFillResult, WebFormPreview } from "../../types";
import type { WebFormBusyState } from "./constants";
import { FillResultCard } from "./FillResultCard";
import { PreviewCard } from "./PreviewCard";

/** 三个标签页的键。 */
type ResultTabKey = "preview" | "pending" | "result";

export function ResultPanel({
  preview,
  result,
  pendingCount,
  pendingPanel,
  selected,
  values,
  aiSuggestions,
  busy,
  running,
  onSelectAiSuggestions,
  onFill,
  onToggle,
  onValueChange,
  sampleLocked = false,
}: {
  preview: WebFormPreview | null;
  result: WebFormFillResult | null;
  /** 待补资料条数（缺失 + 没认出来 + 需要你动手）；0 时不显示这一页。 */
  pendingCount: number;
  /** 已 memo 的待补资料面板，由页面持有（击键路径上引用恒定）。 */
  pendingPanel: ReactNode;
  selected: Set<number>;
  values: Record<number, string>;
  aiSuggestions: WebFormPreview["items"];
  busy: WebFormBusyState;
  running: boolean;
  onSelectAiSuggestions: () => void;
  onFill: () => void;
  onToggle: (index: number) => void;
  onValueChange: (index: number, value: string) => void;
  /** 当前数据集是「体验示例」：「填充到页面」不成立（示例数据不参与真实填表）。 */
  sampleLocked?: boolean;
}) {
  // 本组件用模块级 t()：订阅语言变化，否则切语言后标签与分组名不重渲染。
  useLocale();
  /** 用户手动点过的标签；null = 跟随派生值。 */
  const [manualTab, setManualTab] = useState<ResultTabKey | null>(null);

  // 没有预览也没有结果：这一块整体不该存在（不是"空状态"，是不占位）。
  if (!preview && !result) return null;

  const items: TabsProps["items"] = [];
  if (preview) {
    items.push({
      key: "preview",
      label: t("webFormPage.result.tab.preview"),
      forceRender: true,
      children: (
        <PreviewCard
          preview={preview}
          selected={selected}
          values={values}
          aiSuggestions={aiSuggestions}
          busy={busy}
          running={running}
          onSelectAiSuggestions={onSelectAiSuggestions}
          onFill={onFill}
          onToggle={onToggle}
          onValueChange={onValueChange}
          sampleLocked={sampleLocked}
        />
      ),
    });
  }
  if (preview && pendingCount > 0) {
    items.push({
      key: "pending",
      label: t("webFormPage.result.tab.pending", { count: pendingCount }),
      forceRender: true,
      children: pendingPanel,
    });
  }
  if (result) {
    items.push({
      key: "result",
      label: t("webFormPage.result.tab.result"),
      forceRender: true,
      children: <FillResultCard result={result} />,
    });
  }

  // 派生默认页：填完就看结果，否则看核对表。手动选过的页只要还在就继续用它。
  const fallbackKey: ResultTabKey = result ? "result" : "preview";
  const activeKey =
    manualTab && items.some((item) => item.key === manualTab) ? manualTab : fallbackKey;

  return (
    <section className="webform-result-panel" aria-label={t("webFormPage.result.title")}>
      <Tabs
        size="small"
        activeKey={activeKey}
        items={items}
        onChange={(key) => setManualTab(key as ResultTabKey)}
      />
    </section>
  );
}
