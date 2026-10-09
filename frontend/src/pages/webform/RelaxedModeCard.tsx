/**
 * 放宽模式快捷入口（网申填表页顶部，与「AI 兜底卡」并排）。
 *
 * 与设置页的 `WebFormRelaxedModeCard` 是**同一个开关**（后端持久化）：这里给的是
 * 用表单时的就近入口，改完立即生效——下一次预览就会按新边界算。开启前必须把风险
 * 说清楚，且开启状态下持续显示风险文案（不能只在开的那一瞬间提醒一次）。
 */
import { App, Card, Space, Switch, Typography } from "antd";
import { memo } from "react";
import { useWebFormRelaxedMode } from "../../features/settings/useWebFormRelaxedMode";

/**
 * **memo**：本卡无 props，父组件因别处击键重渲时它整块跳过（自身 hook 的状态更新照常生效）。
 */
export const RelaxedModeCard = memo(function RelaxedModeCard() {
  const { message } = App.useApp();
  const { enabled, loading, saving, toggle } = useWebFormRelaxedMode();

  const onChange = async (checked: boolean) => {
    const saved = await toggle(checked);
    if (saved === checked) {
      message.success(checked ? "已开启：点选类控件将尝试代点，请逐条核对" : "已关闭放宽模式");
    } else {
      message.error("保存放宽模式设置失败");
    }
  };

  return (
    <Card size="small" title="放宽模式（代点下拉与确认勾选）">
      <Space size="middle" wrap>
        <Switch
          checked={enabled}
          loading={loading || saving}
          onChange={(checked) => void onChange(checked)}
          aria-label="网申填表放宽模式"
        />
        <Typography.Text type="secondary">
          默认关闭：工具只填文本框，下拉 / 勾选 / 日期都由你自己点。
          {enabled ? (
            <Typography.Text type="warning">
              已开启——点选类控件若匹配到资料值，程序会代点并回读核对；同意/声明类会先问你。
            </Typography.Text>
          ) : null}
        </Typography.Text>
        <Typography.Text type="warning">
          开启后程序会尝试代点下拉/弹层选项并代勾你逐条确认过的声明项，存在选错可能，
          填完请核对；日期选择器与文件上传仍不代做。
        </Typography.Text>
      </Space>
    </Card>
  );
});
