/**
 * 编辑某条队列条目的招呼语与简历；招呼语可先按岗位生成一版再改。
 * （自 ApplyQueuePanel 拆出，逐字搬运，行为等价；App.useApp() 原本就在本组件内调用。）
 */
import { App, Button, Form, Modal, Select, Space } from "antd";
import { useEffect, useState } from "react";
import { previewGreeting, updateQueueItem } from "../../../api/apply";
import { useResumeSearchSelectForJob } from "../../../hooks/remoteSearchOptions";
import { HintedTextArea } from "../../common/MaxLengthHint";
import type { ApplyQueueItem } from "../../../types";

export function QueueItemEditor({
  item,
  onClose,
  onSaved,
}: {
  item: ApplyQueueItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ greeting: string; resume_id?: number }>();
  // 简历下拉改为远程搜索（P0-1）：候选限定该岗位关联过的简历，
  // 编辑器挂载即打开，挂载时回查已选值并预拉第一页候选。
  const resumeSelect = useResumeSearchSelectForJob(item.job_id);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    form.setFieldsValue({ greeting: item.greeting, resume_id: item.resume_id ?? undefined });
  }, [form, item]);

  useEffect(() => {
    // 已选简历的保显示（P0-1）：按 id 回查补进候选，再预拉第一页候选。
    void resumeSelect.ensure(item.resume_id);
    void resumeSelect.reload();
    // 编辑目标在本组件生命周期内不变，只在挂载时执行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generateGreeting = async () => {
    if (item.job_id == null) return;
    setGenerating(true);
    try {
      const preview = await previewGreeting({ job_id: item.job_id, item_id: item.id });
      form.setFieldValue("greeting", preview.greeting);
      message.success(
        preview.source === "generated" ? "已按岗位生成招呼语" : "已填入默认招呼语（未配置模型）",
      );
    } catch (err) {
      message.error(err instanceof Error ? err.message : "生成招呼语失败");
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await updateQueueItem(item.id, {
        greeting: values.greeting ?? "",
        ...(values.resume_id ? { resume_id: values.resume_id } : {}),
      });
      message.success("队列条目已更新");
      onSaved();
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "更新失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`编辑「${item.job_title || "该岗位"}」`}
      open
      onCancel={onClose}
      footer={null}
      width={560}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="resume_id"
          label="使用简历"
          extra="留空则运行时用该岗位最近一份岗位版简历。"
        >
          <Select
            allowClear
            placeholder="按默认规则解析（输入关键词搜索）"
            {...resumeSelect.selectProps}
          />
        </Form.Item>
        <Form.Item name="greeting" label="招呼语">
          <HintedTextArea rows={3} maxLength={1000} />
        </Form.Item>
      </Form>
      <Space>
        <Button onClick={() => void generateGreeting()} loading={generating}>
          按岗位生成招呼语
        </Button>
        <Button type="primary" loading={saving} onClick={() => void save()}>
          保存
        </Button>
        <Button onClick={onClose}>取消</Button>
      </Space>
    </Modal>
  );
}
