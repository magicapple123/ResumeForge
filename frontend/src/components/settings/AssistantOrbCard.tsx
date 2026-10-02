/** 设置页里的「投投」悬浮球卡片：入口开关与提示标语开关，即改即存。 */

import { App, Card, Divider, Space, Spin, Switch, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { getAssistantOrbSetting, saveAssistantOrbSetting } from "../../api/settings";
import type { AssistantOrbSetting } from "../../types/settings";
import { TOU_TOU_SETTING_EVENT } from "../../features/tou-tou/touTouTypes";

export default function AssistantOrbCard() {
  const { message } = App.useApp();
  const [setting, setSetting] = useState<AssistantOrbSetting>({
    enabled: true,
    tips_enabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSetting(await getAssistantOrbSetting());
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载投投悬浮球设置失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 保存**全量**设置：两个开关共用一份后端对象，只带被改的那个会把另一个打回默认。
   * 乐观更新 + 失败回滚，与页面上其它即改即存的开关保持同一手感。
   */
  const save = async (next: AssistantOrbSetting, successText: string) => {
    if (saving) return;
    setSaving(true);
    const previous = setting;
    setSetting(next);
    try {
      const saved = await saveAssistantOrbSetting(next);
      setSetting(saved);
      window.dispatchEvent(
        new CustomEvent(TOU_TOU_SETTING_EVENT, {
          detail: { enabled: saved.enabled, tips_enabled: saved.tips_enabled },
        }),
      );
      message.success(successText);
    } catch (err) {
      setSetting(previous);
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
        <Space orientation="vertical" size={4}>
          <Switch
            checked={setting.enabled}
            loading={saving}
            checkedChildren="开"
            unCheckedChildren="关"
            aria-label="开启投投悬浮球"
            onChange={(checked) =>
              void save(
                { ...setting, enabled: checked },
                checked ? "已开启投投悬浮球" : "已关闭投投悬浮球",
              )
            }
          />
          <Typography.Text type="secondary">默认开启，可随时在这里关闭。</Typography.Text>
          <Divider style={{ margin: "12px 0 8px" }} />
          <Switch
            checked={setting.tips_enabled}
            loading={saving}
            checkedChildren="开"
            unCheckedChildren="关"
            aria-label="开启投投提示标语"
            onChange={(checked) =>
              void save(
                { ...setting, tips_enabled: checked },
                checked ? "投投会继续弹出提示标语" : "投投不再弹出提示标语",
              )
            }
          />
          <Typography.Text type="secondary">
            关闭后悬浮球不再弹出提示语，其余功能不受影响。
          </Typography.Text>
        </Space>
      </Spin>
    </Card>
  );
}
