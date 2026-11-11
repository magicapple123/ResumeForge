// SPDX-License-Identifier: Apache-2.0
/**
 * 队列的吸底操作条（#14H）：左侧「已选 N / 可投 M」，右侧「开始投递」。
 *
 * 为什么从工具栏搬下来：滚到第 8 行还想勾选/开始投递时，工具栏已经在视口外了。
 * `position: sticky; bottom: 0` 的作用域是**最近的滚动容器**——本页是 `.app-content`
 * （`.app-main` 只是 flex 列，见 base-tasks.css 的 P1-2 注释），所以这条必须留在
 * Tab 内容里（也就是 `.app-content` 的后代），不能挂到任何 `position: fixed` 的浮层上。
 */
import { PlayCircleOutlined } from "@ant-design/icons";
import { Button, Space, Typography } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

export function ApplyQueueStartBar({
  selectedCount,
  eligibleCount,
  busy,
  startDisabled,
  onStart,
}: {
  /** 当前勾选的队列条目数。 */
  selectedCount: number;
  /** 当前筛选结果里可投的条数（= 「全选队列」会勾上的数量）。 */
  eligibleCount: number;
  busy: boolean;
  /** 有任务在跑或没有待投条目时为真。 */
  startDisabled: boolean;
  onStart: () => void;
}) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后计数说明停在旧文案。
  useLocale();
  return (
    <div className="apply-queue-startbar">
      <Space size={8} wrap>
        <Typography.Text strong>
          {t("applyQueue.startBar.count", { selected: selectedCount, eligible: eligibleCount })}
        </Typography.Text>
        <Typography.Text type="secondary">{t("applyQueue.startBar.hint")}</Typography.Text>
      </Space>
      <Button
        type="primary"
        icon={<PlayCircleOutlined />}
        loading={busy}
        disabled={startDisabled}
        onClick={onStart}
      >
        {t("applyQueue.action.start")}
      </Button>
    </div>
  );
}
