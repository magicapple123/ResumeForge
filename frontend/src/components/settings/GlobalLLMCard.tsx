/**
 * 全局模型配置（R21）：一份配置，所有数据集共用。
 *
 * 为什么需要它：一份数据集就是一个完整的 SQLite 文件，"用哪个模型"其实是跨数据集的
 * 偏好。用户在「秋招」和「社招」两份数据之间切换时，不该每换一次就重填一遍地址、
 * 模型和 API Key。
 *
 * 与下方「模型服务」的关系要一眼看清：那个管的是**当前数据集**的配置。这里开关打开时
 * 会接管所有数据集，界面必须把这件事说白——否则用户在 A 数据集里改了下方的配置，
 * 却发现调用还是走全局，会以为保存失败。
 */
import { Alert, App, Button, Card, Form, Input, Switch, Typography } from "antd";
import { useEffect, useState } from "react";
import {
  clearGlobalLLM,
  getGlobalLLM,
  saveGlobalLLM,
  type GlobalLLMSummary,
} from "../../api/settings";

interface FormValues {
  base_url: string;
  model: string;
  api_key?: string;
}

export default function GlobalLLMCard() {
  const { message, modal } = App.useApp();
  const [summary, setSummary] = useState<GlobalLLMSummary | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<FormValues>();

  useEffect(() => {
    let cancelled = false;
    getGlobalLLM()
      .then((data) => {
        if (cancelled) return;
        setSummary(data);
        setEnabled(data.enabled);
        form.setFieldsValue({ base_url: data.base_url, model: data.model, api_key: "" });
      })
      .catch(() => {
        // 读不到（老后端 / 文件损坏）就当作"没配过"，表单仍可填。
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [form]);

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const next = await saveGlobalLLM({
        enabled,
        config: { base_url: values.base_url.trim(), model: values.model.trim() },
        ...(values.api_key ? { api_key: values.api_key } : {}),
      });
      setSummary(next);
      form.setFieldValue("api_key", "");
      message.success(
        next.enabled && next.configured
          ? `全局模型已生效：${next.model}`
          : "已保存，但地址与模型没填全，暂时不会接管调用",
      );
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存全局模型失败");
    } finally {
      setSaving(false);
    }
  };

  const clear = () => {
    modal.confirm({
      title: "清除全局模型配置？",
      content: "清除后每个数据集回到各自「模型服务」里填的那一份。",
      okText: "清除",
      cancelText: "取消",
      onOk: async () => {
        await clearGlobalLLM();
        setSummary(null);
        setEnabled(false);
        form.resetFields();
        message.success("已清除全局模型配置");
      },
    });
  };

  const active = Boolean(summary?.enabled && summary?.configured);

  return (
    <Card className="settings-card" title="全局模型（所有数据集共用）">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        打开后，简历生成、岗位解读、求职助手等**所有数据集**都用这里的配置；关掉则各用各的。
        配置存在数据目录的 <code>global_settings.json</code> 里，密钥加密保存，不会进备份包。
      </Typography.Paragraph>
      {active ? (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 12 }}
          title={`全局模型正在生效：${summary?.model}`}
          description="下方「模型服务」里保存的配置此刻不生效；要改回按数据集分别配置，关掉开关并保存。"
        />
      ) : null}
      {/*
        name 必须给：antd 的字段 id 默认是 name 本身，本卡与下方「模型服务」弹窗都有
        base_url / model / api_key。不给前缀时两处会生成同一个 id，label 的 for 指到
        先渲染的那个——测试里往弹窗填值会填进这张卡（线上表现为"点保存没反应"）。
      */}
      <Form form={form} name="global-llm" layout="vertical" requiredMark={false}>
        <Form.Item label="对所有数据集生效" style={{ marginBottom: 12 }}>
          <Switch checked={enabled} onChange={setEnabled} aria-label="对所有数据集生效" />
        </Form.Item>
        <Form.Item
          name="base_url"
          label="全局接口地址"
          rules={[{ required: enabled, message: "打开全局配置时地址必填" }]}
        >
          <Input placeholder="https://api.deepseek.com/v1" autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="model"
          label="全局模型"
          rules={[{ required: enabled, message: "打开全局配置时模型必填" }]}
        >
          <Input placeholder="deepseek-chat" autoComplete="off" />
        </Form.Item>
        <Form.Item name="api_key" label="全局密钥">
          <Input.Password
            placeholder={summary?.configured ? "留空表示保留已保存的密钥" : "sk-…（加密保存）"}
            autoComplete="new-password"
          />
        </Form.Item>
        <Button type="primary" loading={saving} onClick={() => void save()}>
          应用到所有数据集
        </Button>
        {summary?.configured ? (
          <Button style={{ marginLeft: 8 }} onClick={clear}>
            清除全局配置
          </Button>
        ) : null}
      </Form>
    </Card>
  );
}
