// SPDX-License-Identifier: Apache-2.0
/**
 * 批次完成全局通知：投递/采集批次结束后弹通知 + 系统级桌面通知。
 *
 * 放在全局布局（MainLayout）而非投递台页面：用户跳到任何页面（首页、简历中心……）
 * 都能收到"批次跑完了"的通知，点击即可跳回投递台。窗口在后台时，Web Notification
 * 让操作系统层面也能提示（能拿到权限就发，拿不到就只用应用内通知，绝不主动弹权限框）。
 */
import { BellOutlined } from "@ant-design/icons";
import { App } from "antd";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTaskCompletionWatcher } from "../hooks/useTaskCompletionWatcher";
import { playDoneSound } from "../utils/notifySound";
import { buildTaskNotification, fireWebNotification } from "../utils/taskNotification";

export default function TaskCompletionNotifier() {
  const { notification } = App.useApp();
  const navigate = useNavigate();

  const handleFinished = useCallback(
    ({
      detail,
    }: {
      detail: Parameters<typeof buildTaskNotification>[0] & { items?: unknown[] };
    }) => {
      const payload = buildTaskNotification(detail);
      if (!payload) return;
      fireWebNotification(payload.message, payload.description);
      // 与 AI 生成完成用同一段提示音：用户的要求是"完成就要有声"，
      // 所以不能只有 AI 那条链路响、批次这条不响。
      playDoneSound();
      notification[payload.type]({
        key: `task-finished-${detail.id}`,
        icon: <BellOutlined />,
        title: payload.message,
        description: (
          <span
            role="button"
            tabIndex={0}
            style={{ cursor: "pointer" }}
            onClick={() => navigate("/apply")}
            onKeyDown={(event) => {
              if (event.key === "Enter") navigate("/apply");
            }}
          >
            {payload.description}（点击查看投递台）
          </span>
        ),
        duration: 8,
        placement: "bottomRight",
      });
    },
    [notification, navigate],
  );

  useTaskCompletionWatcher(handleFinished);
  return null;
}
