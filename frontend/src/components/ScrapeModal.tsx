/** 抓取岗位弹窗：选择抓取源、填写关键词，触发抓取。 */
import { Alert, App, Form, Input, InputNumber, Modal, Select, Typography } from "antd";
import { useEffect, useState } from "react";
import { listSources, scrapeJobs } from "../api/jobs";
import { useApi } from "../hooks/useApi";

interface Props {
  open: boolean;
  /** 预选抓取源（从设置页进入时传入） */
  presetSource?: string;
  onClose: () => void;
  onFinished: () => void;
}

export default function ScrapeModal({ open, presetSource, onClose, onFinished }: Props) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const { data: sources } = useApi(listSources);

  useEffect(() => {
    if (open) {
      setResult(null);
      form.setFieldsValue({ source: presetSource ?? sources?.[0]?.name, keyword: "", limit: 20 });
    }
  }, [open, presetSource, sources, form]);

  const submit = async () => {
    const values = await form.validateFields();
    try {
      const data = await scrapeJobs(values);
      setResult({ created: data.created, skipped: data.skipped });
      onFinished();
      if (data.created > 0) {
        message.success(`成功抓取 ${data.created} 个岗位`);
      } else {
        message.info("没有发现新岗位（可能已全部入库）");
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : "抓取失败");
    }
  };

  return (
    <Modal
      title="从网上抓取岗位"
      open={open}
      onOk={() => void submit()}
      onCancel={onClose}
      okText="开始抓取"
      cancelText="取消"
      width={560}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="真实招聘网站接口变动频繁且多有反爬限制，内置示例源仅用于演示；接入真实来源请参考 docs/scraper-guide.md。"
      />
      <Form form={form} layout="vertical">
        <Form.Item name="source" label="抓取源" rules={[{ required: true, message: "请选择抓取源" }]}>
          <Select
            options={(sources ?? []).map((source) => ({
              value: source.name,
              label: `${source.display_name}（${source.description}）`,
            }))}
          />
        </Form.Item>
        <Form.Item name="keyword" label="关键词（选填）">
          <Input placeholder="如：后端开发 / AI 算法" />
        </Form.Item>
        <Form.Item name="limit" label="抓取数量上限">
          <InputNumber min={1} max={100} style={{ width: "100%" }} />
        </Form.Item>
      </Form>
      {result && (
        <Typography.Paragraph type={result.created > 0 ? "success" : "secondary"}>
          本次新增 {result.created} 个岗位，跳过已存在 {result.skipped} 个。
        </Typography.Paragraph>
      )}
    </Modal>
  );
}
