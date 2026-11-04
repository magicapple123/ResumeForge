// SPDX-License-Identifier: Apache-2.0
/**
 * 正式问答结束后的**决策卡**（需求 4）：先问要不要继续追问，再出报告。
 *
 * 为什么要有这一张卡：报告一旦生成就定稿（追问不计入评分），所以"现在就出"和"我再问
 * 几轮"必须由用户当场决定，而不是答完最后一题就被系统推着走。此时 ``status`` 已经是
 * ``finished``，追问接口天然放行，所以追问区在卡片下面**立刻可用**。
 *
 * 卡片本身不持状态：两个动作都交给页面（一个把焦点送到追问输入框，一个调 ``/finish``）。
 */
import { MessageOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Button, Card, Space, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export function FinishDecisionCard({
  onContinueFollowUp,
  onFinish,
  finishing,
}: {
  /** 「继续追问」：页面负责把焦点 / 视线送到下方的追问输入区。 */
  onContinueFollowUp: () => void;
  /** 「结束并生成报告」：页面负责调 ``/finish`` 并在成功后切到报告卡。 */
  onFinish: () => void;
  /** 正在生成报告（十几秒的模型调用）：两个动作都按忙处理。 */
  finishing: boolean;
}) {
  // 本卡用模块级 t()：必须订阅语言变化，否则切语言后卡片文案不重渲染。
  useLocale();
  return (
    <Card size="small" title={t("interviewPage.decision.title")}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Typography.Text type="secondary">
          {finishing ? t("interviewPage.decision.finishing") : t("interviewPage.decision.hint")}
        </Typography.Text>
        <Space wrap>
          <Button
            icon={<MessageOutlined />}
            // 报告在生成时不能再把用户拉去追问：那时点「继续追问」只会让人以为报告取消了。
            disabled={finishing || undefined}
            onClick={onContinueFollowUp}
          >
            {t("interviewPage.decision.continue")}
          </Button>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={finishing}
            onClick={onFinish}
          >
            {t("interviewPage.decision.finish")}
          </Button>
        </Space>
      </div>
    </Card>
  );
}

export default FinishDecisionCard;
