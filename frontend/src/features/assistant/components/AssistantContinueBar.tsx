// SPDX-License-Identifier: Apache-2.0
/**
 * 撞到工具轮次上限时的「继续」入口（需求 #5）。
 *
 * 后端到顶会先停下，并在收尾前下发 `round_limit` 事件（带上真实轮数）。这里把决定权
 * 交回用户：点一下就走**原有发送链路**再发一条消息——不新开端点、不改流协议、不复制
 * 一份发送逻辑。只在事件之后、且当前没有进行中的流时出现；下一轮发送开始时由 store 复位。
 */
import { Button, Space, Typography } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

export default function AssistantContinueBar({
  rounds,
  disabled,
  onContinue,
}: {
  /** 撞到的轮数；null 表示这次回复没有撞上限（不渲染任何东西）。 */
  rounds: number | null;
  /** 正在流式输出时不可点：避免与发送互斥标记打对台。 */
  disabled: boolean;
  onContinue: () => void;
}) {
  useLocale();
  if (rounds === null) return null;
  return (
    <Space size={12} wrap style={{ padding: "0 16px 8px" }}>
      <Typography.Text type="secondary">
        {t("assistantLimits.continue.hint", { rounds })}
      </Typography.Text>
      <Button size="small" type="primary" ghost disabled={disabled} onClick={onContinue}>
        {t("assistantLimits.continue.action")}
      </Button>
    </Space>
  );
}
