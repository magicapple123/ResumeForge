/** 设置页：大模型配置（含预设与连通测试）。 */
import { ApiOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Col, Form, Input, InputNumber, Row, Select, Slider, Space } from "antd";
import { useEffect, useState } from "react";
import { getLLMConfig, saveLLMConfig, testLLM } from "../api/settings";
import { LLM_PRESETS } from "../config";
import type { LLMConfig, LLMTestResult } from "../types";

const PRESET_OPTIONS = LLM_PRESETS.map((preset, index) => ({ value: index, label: preset.label }));

/** 表单字段 = LLM 配置 + 前端专用的预设选择索引 */
type SettingsFormValues = LLMConfig & { preset?: number };

export default function SettingsPage() {
  const [form] = Form.useForm<SettingsFormValues>();
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LLMTestResult | null>(null);

  // 加载已保存的配置；同时把 provider 预设索引还原到 Select（按 base_url 匹配）
  useEffect(() => {
    void getLLMConfig()
      .then((config) => {
        form.setFieldsValue(config);
        const matched = LLM_PRESETS.findIndex((preset) => preset.base_url === config.base_url);
        form.setFieldsValue({ preset: matched >= 0 ? matched : undefined });
      })
      .catch((err) => message.error(err instanceof Error ? err.message : "加载配置失败"));
  }, [form, message]);

  const applyPreset = (index: number) => {
    const preset = LLM_PRESETS[index];
    if (!preset) return;
    form.setFieldsValue({ base_url: preset.base_url, model: preset.model });
  };

  /** 收集表单值并剔除前端专用的 preset 字段 */
  const collectValues = async (): Promise<LLMConfig> => {
    const values = await form.validateFields();
    return {
      provider: values.provider,
      base_url: values.base_url,
      api_key: values.api_key,
      model: values.model,
      temperature: values.temperature,
      timeout_seconds: values.timeout_seconds,
      max_tokens: values.max_tokens,
    };
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveLLMConfig(await collectValues());
      message.success("配置已保存");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testLLM(await collectValues()));
    } catch (err) {
      setTestResult({ ok: false, latency_ms: null, message: err instanceof Error ? err.message : "测试失败" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ maxWidth: 960 }}>
      <Card title="大模型 API 配置" style={{ marginBottom: 16 }}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="支持所有兼容 OpenAI Chat Completions 协议的模型服务：DeepSeek、豆包（火山方舟）、Kimi、智谱、OpenAI、Ollama 等。API Key 保存在本地数据库中，仅本机可访问。"
        />
        <Form form={form} layout="vertical">
          <Form.Item name="preset" label="快速预设（选择后自动填充 Base URL 与模型名）">
            <Select options={PRESET_OPTIONS} onChange={(value) => applyPreset(value as number)} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={16}>
              <Form.Item
                name="base_url"
                label="Base URL"
                rules={[{ required: true, message: "必填" }]}
                tooltip="服务地址，通常形如 https://api.xxx.com 或 https://api.xxx.com/v1"
              >
                <Input placeholder="https://api.deepseek.com" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="model"
                label="模型名称"
                rules={[{ required: true, message: "必填" }]}
                tooltip="各厂商模型名不同，请以官方文档为准"
              >
                <Input placeholder="deepseek-chat" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="api_key"
            label="API Key"
            rules={[{ required: true, message: "必填" }]}
            tooltip="密钥只保存在本机，不会上传到任何第三方"
          >
            <Input.Password placeholder="sk-..." autoComplete="off" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="temperature" label="创意度 temperature">
                <Slider min={0} max={2} step={0.1} marks={{ 0: "严谨", 1: "均衡", 2: "发散" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="timeout_seconds" label="超时时间（秒）">
                <InputNumber min={10} max={600} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="max_tokens" label="最大输出 Token">
                <InputNumber min={256} max={65536} step={512} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Space>
            <Button type="primary" loading={saving} onClick={() => void save()}>
              保存配置
            </Button>
            <Button icon={<ApiOutlined />} loading={testing} onClick={() => void test()}>
              测试连接
            </Button>
          </Space>
        </Form>
        {testResult && (
          <Alert
            style={{ marginTop: 16 }}
            type={testResult.ok ? "success" : "error"}
            showIcon
            message={
              testResult.ok
                ? `${testResult.message}（耗时 ${testResult.latency_ms}ms）`
                : `连接失败：${testResult.message}`
            }
          />
        )}
      </Card>
    </div>
  );
}
