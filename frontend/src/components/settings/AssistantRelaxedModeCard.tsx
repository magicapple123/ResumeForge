/**
 * 求职助手「放宽模式」卡（设置页 · AI 模型）。
 *
 * 默认关。开启后助手可读取**完整资料**——姓名、电话、邮箱等身份字段，网申填表的
 * 真实填写值，以及历史对话。开启前把解锁范围与始终不解锁的边界说清楚（提前告知
 * 是这个功能成立的前提）：API 密钥等凭据任何模式都不发给模型，简历照片二进制不发送，
 * 也没有删除类工具。
 */
import { App, Card, Space, Spin, Switch, Typography } from "antd";
import { useEffect, useState } from "react";
import { getAssistantRelaxedMode, saveAssistantRelaxedMode } from "../../api/settings";

export default function AssistantRelaxedModeCard() {
  const { message } = App.useApp();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Compiler 规范：挂载加载用内联 async IIFE（setState 在自身回调里应用）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await getAssistantRelaxedMode();
        if (!cancelled) setEnabled(saved.enabled);
      } catch {
        // 读不到按默认关处理：这是扩权开关，保守显示比假装开着安全。
        if (!cancelled) setEnabled(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onChange = async (checked: boolean) => {
    if (saving) return;
    setSaving(true);
    setEnabled(checked);
    try {
      const saved = await saveAssistantRelaxedMode({ enabled: checked });
      setEnabled(saved.enabled);
      message.success(
        checked
          ? "已开启放宽模式：求职助手现在可以读取完整资料（含敏感信息）"
          : "已关闭：助手回到默认的脱敏视图，敏感工具不再下发",
      );
    } catch (err) {
      setEnabled(!checked);
      message.error(err instanceof Error ? err.message : "保存助手放宽模式设置失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="求职助手 · 放宽模式" className="settings-card">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        默认关闭：助手读到的是脱敏资料（不含姓名、电话等身份字段），也没有网申填写值与
        历史对话工具。
      </Typography.Paragraph>
      <Spin spinning={loading}>
        <Space orientation="vertical" size={4}>
          <Switch
            checked={enabled}
            loading={saving}
            checkedChildren="开"
            unCheckedChildren="关"
            aria-label="求职助手放宽模式"
            onChange={(checked) => void onChange(checked)}
          />
          <Typography.Text type={enabled ? "warning" : "secondary"}>
            {enabled
              ? "已开启：助手可以读取完整资料——姓名、电话、邮箱等身份字段，网申填表的真实填写值，以及你的历史对话；这些内容会随提问发送给你配置的大模型服务商。请仅在本人设备上开启。"
              : "开启前请知悉：开启后助手可读取完整资料（含姓名、电话等敏感信息）、网申填表的真实填写值与历史对话，这些内容会随提问发送给你配置的大模型服务商。"}
          </Typography.Text>
          <Typography.Text type="secondary">
            任何模式下都不会发送：API
            密钥等凭据与全局配置、简历照片的图片内容；助手也永远没有删除类工具。
          </Typography.Text>
        </Space>
      </Spin>
    </Card>
  );
}
