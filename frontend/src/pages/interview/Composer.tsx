// SPDX-License-Identifier: Apache-2.0
/**
 * 面试作答区：输入框 + 「提交回答」/「停止本轮」。
 *
 * 自 InterviewPage 拆出（T04-c）：页面本体贴着 500 行预算，而这一段是纯渲染。
 *
 * 「停止本轮」是这个组件存在的实质理由：一轮生成要十几到几十秒，用户不该被迫等完。
 * 生成中按钮换成它——点下去 abort 掉 SSE，界面立刻回到可继续提问的状态，服务端把这一轮
 * 标成 interrupted（回答保留，可重答）。**不是**"结束面试"：那是 RoomHeader 上的另一件事。
 */
import { StopOutlined } from "@ant-design/icons";
import { Button, Input, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export function Composer({
  value,
  submitting,
  onChange,
  onSubmit,
  onStop,
}: {
  /** 输入框里的文字（受控）。 */
  value: string;
  /** 是否正在生成：输入框禁用，按钮换成「停止本轮」。 */
  submitting: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** 停止本轮：abort 当前请求，页面立刻回到可提问状态。 */
  onStop: () => void;
}) {
  useLocale();
  return (
    <div className="interview-composer">
      <Input.TextArea
        value={value}
        autoSize={{ minRows: 3, maxRows: 10 }}
        placeholder={t("interview.placeholder")}
        disabled={submitting}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      <div className="interview-composer-actions">
        <Typography.Text type="secondary">{t("interview.hint.dontKnow")}</Typography.Text>
        {submitting ? (
          // 生成中：主按钮换成「停止本轮」，不加载动画——这时候"转圈"传达的是"请等"，
          // 而我们要说的是"可以不等"。
          <Button danger icon={<StopOutlined />} onClick={onStop}>
            {t("interview.action.stopRound")}
          </Button>
        ) : (
          <Button type="primary" disabled={!value.trim()} onClick={onSubmit}>
            {t("interview.action.submit")}
          </Button>
        )}
      </div>
    </div>
  );
}

export default Composer;
