// SPDX-License-Identifier: Apache-2.0
/** 首页顶部的「第一份交付」进度面板：三条路径、当前步高亮、CTA 直达。
 *
 * 只在 `allDone === false` 时由 HomePage 渲染——全完成还挂一块"你还没完成"的
 * 面板是在打扰人。面板放首页最上方，因为"下一步做什么"比统计数字更重要。
 * 视觉克制：完成态置灰打勾、当前态高亮带 CTA、未来态弱化，不新增弹窗与轮询。
 */
import { CheckCircleFilled, RightOutlined, RocketOutlined } from "@ant-design/icons";
import { Card, Space, Typography } from "antd";
import { Link } from "react-router-dom";
import type { ActivationStage } from "./useActivationProgress";

export function FirstDeliveryPanel({ stages }: { stages: ActivationStage[] }) {
  // 当前步 = 第一条未完成；它之前的都算完成态，之后的是未来态。
  const currentIndex = stages.findIndex((stage) => !stage.done);

  return (
    <Card
      className="first-delivery-panel"
      // 与下方统计卡留出间距：页面其他区块之间都是 16px，这里之前是贴死的。
      style={{ marginBottom: 16 }}
      title={
        <Space size={8}>
          <RocketOutlined />
          <span>从零到第一份可交付简历</span>
        </Space>
      }
    >
      <ul className="first-delivery-stages">
        {stages.map((stage, index) => {
          const isDone = stage.done;
          const isCurrent = index === currentIndex;
          return (
            <li
              key={stage.key}
              className={
                isDone
                  ? "first-delivery-stage is-done"
                  : isCurrent
                    ? "first-delivery-stage is-current"
                    : "first-delivery-stage is-upcoming"
              }
            >
              <span className="first-delivery-stage-icon" aria-hidden="true">
                {isDone ? <CheckCircleFilled /> : index + 1}
              </span>
              <span className="first-delivery-stage-copy">
                <span className="first-delivery-stage-title">
                  {stage.title}
                  {isDone && <Typography.Text type="secondary">已完成</Typography.Text>}
                </span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {stage.description}
                </Typography.Text>
                {/* 真实进度（如"已核实 2/5 条主张"）：完成与未完成都展示，进度不说谎。 */}
                {stage.progress && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {stage.progress}
                  </Typography.Text>
                )}
                {isCurrent && stage.cta && (
                  <span className="first-delivery-cta-row">
                    <Link to={stage.cta.path} className="first-delivery-cta">
                      {stage.cta.label}
                      <RightOutlined aria-hidden="true" />
                    </Link>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {stage.cta.hint}
                    </Typography.Text>
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        手动填写、本地检查与导出不需要配置模型；需要 AI 的功能随时可在设置里配。
      </Typography.Text>
    </Card>
  );
}
