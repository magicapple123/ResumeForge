// SPDX-License-Identifier: Apache-2.0
/**
 * 投递设置弹窗：间隔、上限、熔断阈值、默认招呼语与专用浏览器端口。
 *
 * 除了必填校验，每个字段都回显**出厂默认值**——用户改乱了设置后需要知道"原来的值是什么"，
 * 否则只能去翻文档或重装。
 */
import {
  Button,
  Divider,
  Form,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Typography,
  App,
} from "antd";
import PageSkeleton from "../common/PageSkeleton";
import { useEffect, useState } from "react";
import { getApplyConfig, listSites, updateApplyConfig } from "../../api/apply";
import { useApi } from "../../hooks/useApi";
import { HintedTextArea } from "../common/MaxLengthHint";
import { type ApplyConfig, type ApplyConfigOut, type SiteList } from "../../types";
import BrowserChoiceFields from "./BrowserChoiceFields";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: (config: ApplyConfigOut) => void;
}

/**
 * 出厂默认值的回显文案。
 *
 * 布尔值先翻成「开启 / 关闭」再交给模板：那两个词是**取值**，模板由
 * `applySettings.defaults.hint` 的 `{value}` 接住（§8.1 说的是模块求值期不能调 `t()`，
 * 本函数在渲染期调用，因此随语言变化）。
 */
function defaultsHint(value: string | number | boolean): string {
  const shown =
    typeof value === "boolean"
      ? t(value ? "applySettings.defaults.on" : "applySettings.defaults.off")
      : value;
  return t("applySettings.defaults.hint", { value: shown });
}

function ApplySettingsForm({ onClose, onSaved }: Omit<Props, "open">) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const { message } = App.useApp();
  const [form] = Form.useForm<ApplyConfig>();
  const { data, loading, error } = useApi<ApplyConfigOut>(getApplyConfig, []);
  // 站点清单来自后端接口，前端不写死站点名；将来后端加站点这里自动多出选项。
  // `display_name` 由服务端下发，因此不经过语言包（前端没有第二份真相）。
  const { data: siteList } = useApi<SiteList>(listSites, []);
  const [saving, setSaving] = useState(false);
  const defaults = data?.defaults;
  const siteOptions = (siteList?.sites ?? []).map((site) => ({
    value: site.key,
    label: site.display_name,
  }));

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  const submit = async () => {
    let values: ApplyConfig;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const saved = await updateApplyConfig(values);
      message.success(t("applySettings.saved"));
      onSaved?.(saved);
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("applySettings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) {
    return <PageSkeleton rows={8} card={false} />;
  }
  if (error && !data) {
    return (
      <Space orientation="vertical" style={{ width: "100%" }}>
        <Typography.Text type="danger">{error}</Typography.Text>
        {/* 保留：只在「读取失败且没有任何数据」时渲染，是失败态唯一的显式出口
            （表单都没渲染出来，不能靠 × 之外的动作离开）。 */}
        <Button onClick={onClose}>{t("common.action.close")}</Button>
      </Space>
    );
  }

  return (
    <Form form={form} layout="vertical" onFinish={() => void submit()}>
      {/*
        整段合成一个 key（原文「成功投递」外面套过 `<Typography.Text strong>`）：
        富文本插值不存在，按标签切开的两半在英文里语序不通，强调让位于完整句子。
      */}
      <Typography.Paragraph type="secondary">{t("applySettings.intro")}</Typography.Paragraph>

      <Space size={16} wrap>
        <Form.Item
          name="interval_seconds"
          label={t("applySettings.interval.label")}
          extra={defaults && defaultsHint(defaults.interval_seconds)}
          rules={[{ required: true, message: t("applySettings.interval.required") }]}
        >
          <InputNumber min={1} max={600} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item
          name="interval_jitter_seconds"
          label={t("applySettings.jitter.label")}
          extra={defaults && defaultsHint(defaults.interval_jitter_seconds)}
        >
          <InputNumber min={0} max={300} style={{ width: 160 }} />
        </Form.Item>
      </Space>

      <Space size={16} wrap>
        <Form.Item
          name="daily_limit"
          label={t("applySettings.dailyLimit.label")}
          extra={defaults && defaultsHint(defaults.daily_limit)}
          rules={[{ required: true, message: t("applySettings.dailyLimit.required") }]}
        >
          <InputNumber min={1} max={1000} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item
          name="per_task_limit"
          label={t("applySettings.perTaskLimit.label")}
          extra={defaults && defaultsHint(defaults.per_task_limit)}
        >
          <InputNumber min={1} max={200} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item
          name="breaker_threshold"
          label={t("applySettings.breaker.label")}
          extra={defaults && defaultsHint(defaults.breaker_threshold)}
        >
          <InputNumber min={1} max={20} style={{ width: 160 }} />
        </Form.Item>
      </Space>

      <Form.Item
        name="default_greeting"
        label={t("applySettings.greeting.label")}
        extra={t("applySettings.greeting.extra")}
      >
        <HintedTextArea rows={2} maxLength={1000} />
      </Form.Item>

      <Divider plain style={{ margin: "4px 0 16px" }} />

      <Form.Item
        name="site_key"
        label={t("applySettings.site.label")}
        extra={t("applySettings.site.extra")}
      >
        <Select
          options={siteOptions}
          style={{ maxWidth: 280 }}
          placeholder={t("applySettings.site.placeholder")}
        />
      </Form.Item>

      <Divider plain style={{ margin: "4px 0 16px" }} />

      <BrowserChoiceFields label={t("applySettings.browser.label")} />

      <Form.Item
        name="browser_port"
        label={t("applySettings.browserPort.label")}
        extra={defaults && defaultsHint(defaults.browser_port)}
      >
        <InputNumber min={1024} max={65535} style={{ width: 160 }} />
      </Form.Item>

      <Form.Item
        name="skip_same_company"
        label={t("applySettings.skipSameCompany.label")}
        valuePropName="checked"
        // 光写"同公司只投一个岗位"会被读成全历史：用户会以为投过百度就永远不能再投百度的
        // 其他岗位。**作用域就是本批**，必须写在这里——开关的语义只能由它的说明来界定。
        extra={
          <>
            {t("applySettings.skipSameCompany.extra")}
            {defaults && <div>{defaultsHint(defaults.skip_same_company)}</div>}
          </>
        }
      >
        <Switch />
      </Form.Item>
      <Form.Item
        name="confirm_real_gap"
        label={t("applySettings.realGap.label")}
        valuePropName="checked"
        extra={t("applySettings.realGap.extra")}
      >
        <Switch />
      </Form.Item>

      {/* 底部操作区：**吸附在可视区底部**（不再随内容滚走），靠右并排。
          这个表单有七八个字段，用户改到中间想保存时不该先滚到底。 */}
      <div className="apply-settings-actions">
        <Button onClick={onClose}>{t("common.action.cancel")}</Button>
        <Button type="primary" loading={saving} onClick={() => void submit()}>
          {t("applySettings.action.save")}
        </Button>
      </div>
    </Form>
  );
}

export default function ApplySettingsModal({ open, onClose, onSaved }: Props) {
  // 弹窗标题也走词表：`open` 为假时表单不渲染，订阅放在这里才不会漏掉标题。
  useLocale();
  return (
    <Modal
      title={t("applySettings.title")}
      open={open}
      onCancel={onClose}
      footer={null}
      mask={{ closable: false }}
      width={620}
      destroyOnHidden
      styles={{
        // 表单很长：限高滚动，别顶满整屏（与全站弹窗口径一致）。
        body: { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto", paddingRight: 8 },
      }}
    >
      {open && <ApplySettingsForm onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}
