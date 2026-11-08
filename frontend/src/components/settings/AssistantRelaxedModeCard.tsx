// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「求职助手 · 数据权限」卡（T11）。
 *
 * 四档同时决定读、写两轴：仅查看 / 放宽读取 / 可修改 / 完全权限。这里保存的是**全局默认**；
 * 输入框旁的下拉按会话覆盖（本机 localStorage）。扩权前把解锁范围与始终不解锁的边界
 * 说清楚——提前告知是这个功能成立的前提：API 密钥等凭据任何档位都不发给模型，简历照片
 * 二进制不发送，助手也没有删除类工具。
 */
import { App, Card, Radio, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import LoadingBlock from "../common/LoadingBlock";
import { getAssistantPermission, saveAssistantPermission } from "../../api/assistantPermission";
import type { AssistantPermissionLevel } from "../../api/assistantPermission";
import {
  ASSISTANT_PERMISSION_DESC_KEYS,
  ASSISTANT_PERMISSION_LABEL_KEYS,
  ASSISTANT_PERMISSION_LEVELS,
  bumpAssistantPermission,
  isWriteLevel,
} from "../../features/assistant/assistantPermission";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export default function AssistantRelaxedModeCard() {
  // 本组件用模块级 t()：必须订阅语言变化。
  useLocale();
  const { message } = App.useApp();
  const [permission, setPermission] = useState<AssistantPermissionLevel>("read_only");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Compiler 规范：挂载加载用内联 async IIFE（setState 在自身回调里应用）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await getAssistantPermission();
        if (!cancelled) setPermission(saved.permission);
      } catch {
        // 读不到按默认「仅查看」处理：这是扩权设置，保守显示比假装开着安全。
        if (!cancelled) setPermission("read_only");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onChange = async (next: AssistantPermissionLevel) => {
    if (saving || next === permission) return;
    const previous = permission;
    setSaving(true);
    setPermission(next);
    try {
      const saved = await saveAssistantPermission({ permission: next });
      setPermission(saved.permission);
      // 输入区那块下拉的「跟随全局」立刻跟着变：清掉进程内缓存并通知订阅方重取。
      bumpAssistantPermission();
      message.success(
        t("assistantPermission.settings.saveToast", {
          level: t(ASSISTANT_PERMISSION_LABEL_KEYS[saved.permission]),
        }),
      );
    } catch (err) {
      setPermission(previous);
      message.error(
        err instanceof Error ? err.message : t("assistantPermission.settings.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={t("assistantPermission.settings.title")} className="settings-card">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("assistantPermission.settings.intro")}
      </Typography.Paragraph>
      <LoadingBlock spinning={loading}>
        <Space orientation="vertical" size={12}>
          <Radio.Group
            aria-label={t("assistantPermission.settings.aria")}
            value={permission}
            disabled={saving}
            onChange={(event) => void onChange(event.target.value as AssistantPermissionLevel)}
          >
            <Space orientation="vertical" size={8}>
              {ASSISTANT_PERMISSION_LEVELS.map((level) => (
                <Radio key={level} value={level}>
                  <span className="assistant-permission-option">
                    <span className="assistant-permission-option-name">
                      {t(ASSISTANT_PERMISSION_LABEL_KEYS[level])}
                    </span>
                    <span className="assistant-permission-option-desc">
                      {t(ASSISTANT_PERMISSION_DESC_KEYS[level])}
                    </span>
                  </span>
                </Radio>
              ))}
            </Space>
          </Radio.Group>
          <Typography.Text type="secondary">
            {t("assistantPermission.settings.state", {
              level: t(ASSISTANT_PERMISSION_LABEL_KEYS[permission]),
            })}
          </Typography.Text>
          {isWriteLevel(permission) ? (
            <Typography.Text type="warning">
              {t("assistantPermission.settings.writeHint")}
            </Typography.Text>
          ) : null}
          <Typography.Text type="secondary">
            {t("assistantPermission.settings.neverSent")}
          </Typography.Text>
        </Space>
      </LoadingBlock>
    </Card>
  );
}
