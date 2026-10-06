/**
 * 网申填表「放宽模式」卡（设置页 · 应用）。
 *
 * 默认关。开启前把边界说清楚：程序会代点什么、什么仍然不代做、风险是什么。
 * 文案与后端 `engine.core.relaxed_kind` 的注释同源——那里是代码事实，这里是用户可见的
 * 承诺，两者只许同时改。
 */
import { App, Card, Space, Spin, Switch, Typography } from "antd";
import { useWebFormRelaxedMode } from "../../features/settings/useWebFormRelaxedMode";

export default function WebFormRelaxedModeCard() {
  const { message } = App.useApp();
  const { enabled, loading, saving, toggle } = useWebFormRelaxedMode();

  const onChange = async (checked: boolean) => {
    const saved = await toggle(checked);
    if (saved === checked) {
      message.success(checked ? "已开启放宽模式" : "已关闭：回到「只填不点」的默认边界");
    } else {
      message.error("保存放宽模式设置失败");
    }
  };

  return (
    <Card title="网申填表 · 放宽模式" className="settings-card">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        默认关闭：网申填表「只填不点」，下拉、勾选、日期都需要你在页面上自己点。
      </Typography.Paragraph>
      <Spin spinning={loading}>
        <Space orientation="vertical" size={4}>
          <Switch
            checked={enabled}
            loading={saving}
            checkedChildren="开"
            unCheckedChildren="关"
            aria-label="网申填表放宽模式"
            onChange={(checked) => void onChange(checked)}
          />
          <Typography.Text type={enabled ? "warning" : "secondary"}>
            开启后程序会尝试代点下拉/弹层选项并代勾你逐条确认过的声明项，存在选错可能，
            填完请核对；日期选择器与文件上传仍不代做。
          </Typography.Text>
        </Space>
      </Spin>
    </Card>
  );
}
