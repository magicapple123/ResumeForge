// SPDX-License-Identifier: Apache-2.0
/**
 * 批量 AI 的**全局浮条**：任务在跑、而用户已经切到别的页面时，仍能看见进度并停止。
 *
 * 状态来自 `jobBulkAiRunner` 的模块级 store（跨路由天然存活），这里只是第二个出口：
 * 岗位页已有工具栏内联进度条，两条同时出现是重复信息，所以**只在非岗位页渲染**。
 *
 * 完成通知仍由 `notifyTaskDone` 单一来源负责（见 runner）；本组件只管"进行中"，
 * 不再挂第二套完成提示。也刻意**不接** `utils/backgroundTasks` 登记表：那是
 * adapter + 轮询服务端任务的模型，而批量 AI 没有服务端任务实体，硬接要扩展登记表。
 */
import { LoadingOutlined } from "@ant-design/icons";
import { Button, Space, Typography } from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import { stopBulkAi, useBulkAiState } from "../jobs/jobBulkAiRunner";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export default function BulkAiFloatingBar() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这条文案不重渲染。
  useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const state = useBulkAiState();

  // 岗位页有自己的内联进度条；空闲时什么都不渲染（不留一条空横条占位）。
  if (!state.running || location.pathname === "/jobs") return null;

  const label = t(
    state.kind === "analysis"
      ? "batchOperation.floating.running.analysis"
      : "batchOperation.floating.running.resume",
    { done: state.done, total: state.total, title: state.currentTitle },
  );

  return (
    <div className="bulk-ai-floating-bar" role="status" aria-live="polite">
      <LoadingOutlined className="bulk-ai-floating-spin" />
      <Typography.Text className="bulk-ai-floating-text" ellipsis>
        {label}
      </Typography.Text>
      <Space size={4} className="bulk-ai-floating-actions">
        <Button size="small" type="link" onClick={() => navigate("/jobs")}>
          {t("batchOperation.floating.view")}
        </Button>
        <Button
          size="small"
          type="text"
          danger
          disabled={state.stopRequested}
          onClick={() => stopBulkAi()}
        >
          {t("batchOperation.floating.stop")}
        </Button>
      </Space>
    </div>
  );
}
