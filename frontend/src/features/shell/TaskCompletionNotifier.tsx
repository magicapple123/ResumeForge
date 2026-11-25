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
import { recordNotification } from "../../api/notifications";
import { useTaskCompletionWatcher } from "../../hooks/useTaskCompletionWatcher";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import {
  failureInterruptAllowed,
  interruptAllowed,
  soundAllowed,
} from "../../utils/notificationPreferences";
import { playDoneSound } from "../../utils/notifySound";
import { buildTaskNotification, fireWebNotification } from "../../utils/taskNotification";

export default function TaskCompletionNotifier() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这块文案不重渲染。
  useLocale();
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
      // CR-29：「批次完成」是结果类，默认安静。关掉开关时只记 inbox，不弹、不响。
      // 失败/停止不在"结果类"里——那需要用户处理，按决策类放行（静默时段仍然压住）。
      const failed = detail.status !== "completed";
      const allow = failed ? failureInterruptAllowed() : interruptAllowed("batch");
      if (allow) {
        fireWebNotification(payload.message, payload.description);
      }
      // CR-25：批次完成/失败同时落通知中心——错过的还能回看（与提醒、AI 任务同一张表）。
      void recordNotification({
        type: "background_task",
        severity: detail.status === "failed" ? "warning" : "info",
        title: payload.message,
        body: payload.description,
        deep_link: "/apply",
        dedupe_key: `batch:${detail.kind}:${detail.id}:${detail.status}`,
      }).catch(() => {
        /* 回看记录写失败不影响即时提醒。 */
      });
      if (allow && soundAllowed()) {
        // 与 AI 生成完成用同一段提示音：用户的要求是"完成就要有声"，
        // 所以不能只有 AI 那条链路响、批次这条不响。没弹通知时也不该单独响一声。
        playDoneSound();
      }
      if (!allow) return;
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
            {payload.description}
            {t("backgroundTasks.batch.clickToView")}
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
