// SPDX-License-Identifier: Apache-2.0
/**
 * 采集条件的表单区块：关键词/城市/单批上限/站点筛选/间隔与抖动/保存站点原文。
 *
 * 受控组件：form 实例由 CollectPanel 持有（保存/开始都要 validateFields），这里只负责
 * 渲染 Form.Item；`Form.Item` 经 Form context 注册到同一个 form，零独立状态。
 *
 * 2026-10-09 起不再有「采集后筛选」（期望薪资/经验/学历/岗位类型）——条件过滤全权
 * 交给下面的站点侧筛选（用户决定：采回来再筛的层用不上，连同依赖它的「校招」档一起
 * 下线）。schema 里的字段保留以兼容旧配置，前端不再发送。
 */
import { PlayCircleOutlined, SaveOutlined } from "@ant-design/icons";
import { Button, Checkbox, Form, Input, InputNumber, Select, Space, Typography } from "antd";
import type { FormInstance } from "antd";
import type { CollectConfig } from "../../../types";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import CollectSiteFilters from "../CollectSiteFilters";

interface Props {
  form: FormInstance<CollectConfig>;
  /** 读取当前表单里选中的站点筛选项（「测试是否生效」按钮用），原样转传给站点筛选区块。 */
  getFilters: () => Record<string, string>;
  saveSamples: boolean;
  onSaveSamplesChange: (checked: boolean) => void;
  disabled: boolean;
  saving: boolean;
  starting: boolean;
  onSave: () => void;
  onStart: () => void;
}

export default function CollectConfigForm({
  form,
  getFilters,
  saveSamples,
  onSaveSamplesChange,
  disabled,
  saving,
  starting,
  onSave,
  onStart,
}: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  return (
    <Form form={form} layout="vertical">
      <Form.Item
        name="keywords"
        label={t("applyCollect.field.keywords")}
        extra={t("applyCollect.hint.keywords")}
      >
        <Select mode="tags" placeholder={t("applyCollect.placeholder.keywords")} open={false} />
      </Form.Item>
      {/* align="start"：让各列的控件顶边对齐，避免某项说明较长时把旁边的输入框挤得高低不齐。 */}
      <Space size={16} wrap align="start">
        <Form.Item name="city" label={t("applyCollect.field.city")}>
          <Input placeholder={t("applyCollect.placeholder.city")} style={{ width: 180 }} />
        </Form.Item>
        <Form.Item name="per_task_limit" label={t("applyCollect.field.perTaskLimit")}>
          <InputNumber min={1} max={200} style={{ width: 140 }} />
        </Form.Item>
      </Space>

      {/* 站点侧筛选：招聘网站自己的筛选栏。它现在承担**全部**条件过滤——网站在搜索
          时就把不符合的岗位筛掉了，比采回来再筛更准也更省。 */}
      <CollectSiteFilters disabled={disabled} getFilters={getFilters} />

      <Space size={16} wrap align="start">
        <Form.Item name="interval_seconds" label={t("applyCollect.field.intervalSeconds")}>
          <InputNumber min={1} max={600} style={{ width: 140 }} />
        </Form.Item>
        <Form.Item name="interval_jitter_seconds" label={t("applyCollect.field.jitterSeconds")}>
          <InputNumber min={1} max={300} style={{ width: 140 }} />
        </Form.Item>
      </Space>

      {/* 保存站点原文：这是排查解析问题 / 做真实样例回归的通道，属于支持路径而非日常流程，
          所以放在「开始采集」旁边、默认不勾，并把"存什么、存哪、会不会外传"一次说清——
          用户不知道它会往磁盘写东西就会用错。 */}
      <Form.Item style={{ marginBottom: 12 }}>
        <Checkbox
          checked={saveSamples}
          onChange={(event) => onSaveSamplesChange(event.target.checked)}
          aria-label={t("applyCollect.field.saveSamples")}
        >
          {t("applyCollect.field.saveSamples")}
        </Checkbox>
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }}>
          {t("applyCollect.hint.saveSamples")}
        </Typography.Text>
      </Form.Item>

      <Space>
        <Button icon={<SaveOutlined />} loading={saving} onClick={onSave}>
          {t("applyCollect.action.save")}
        </Button>
        <Button
          type="primary"
          icon={<PlayCircleOutlined />}
          loading={starting}
          disabled={disabled}
          onClick={onStart}
        >
          {t("applyCollect.action.start")}
        </Button>
      </Space>
    </Form>
  );
}
