/** 设置页里的「投投」悬浮球开关。开关即改即存，不占用模型编辑态。 */

import { App, Card, Space, Spin, Switch, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { getAssistantOrbSetting, saveAssistantOrbSetting } from "../../api/settings";
import { TOU_TOU_SETTING_EVENT } from "../../features/tou-tou/touTouTypes";

export default function AssistantOrbCard() {
  const { message } = App.useApp();
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEnabled((await getAssistantOrbSetting()).enabled);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载投投悬浮球设置失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (checked: boolean) => {
    if (saving) return;
    setSaving(true);
    setEnabled(checked);
    try {
      const saved = await saveAssistantOrbSetting(checked);
      setEnabled(saved.enabled);
      window.dispatchEvent(
        new CustomEvent(TOU_TOU_SETTING_EVENT, { detail: { enabled: saved.enabled } }),
      );
      message.success(saved.enabled ? "已开启投投悬浮球" : "已关闭投投悬浮球");
    } catch (err) {
      setEnabled(!checked);
      message.error(err instanceof Error ? err.message : "保存投投悬浮球设置失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="投投悬浮球" className="settings-card">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        在应用各页面保留一个轻量的求职助手入口。点击它可以直接进入助手，静置后会自动贴边收起，
        不会遮挡主要内容。
      </Typography.Paragraph>
      <Spin spinning={loading}>
        <Space direction="vertical" size={4}>
          <Switch
            checked={enabled}
            loading={saving}
            checkedChildren="开"
            unCheckedChildren="关"
            aria-label="开启投投悬浮球"
            onChange={(checked) => void toggle(checked)}
          />
          <Typography.Text type="secondary">默认开启，可随时在这里关闭。</Typography.Text>
        </Space>
      </Spin>
    </Card>
  );
}
