/** 岗位新增/编辑弹窗：手动添加岗位信息。 */
import { App, Form, Input, Modal, Select } from "antd";
import { useEffect } from "react";
import { createJob, updateJob } from "../api/jobs";
import type { Job } from "../types";

interface Props {
  open: boolean;
  /** 传入岗位表示编辑，null 表示新增 */
  initial: Job | null;
  onClose: () => void;
  onSaved: () => void;
}

const JOB_TYPE_OPTIONS = ["校招", "实习", "社招", "其他"].map((value) => ({ value, label: value }));
const STATUS_OPTIONS = ["开放中", "已截止", "已投递"].map((value) => ({ value, label: value }));

export default function JobFormModal({ open, initial, onClose, onSaved }: Props) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const isEdit = !!initial;

  // 打开时回填编辑数据（或重置为默认值）
  useEffect(() => {
    if (!open) return;
    if (initial) {
      form.setFieldsValue(initial);
    } else {
      form.resetFields();
    }
  }, [open, initial, form]);

  const submit = async () => {
    const values = await form.validateFields();
    try {
      if (isEdit && initial) {
        await updateJob(initial.id, values);
        message.success("岗位已更新");
      } else {
        await createJob(values);
        message.success("岗位已添加");
      }
      onSaved();
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    }
  };

  return (
    <Modal
      title={isEdit ? "编辑岗位" : "手动添加岗位"}
      open={open}
      onOk={() => void submit()}
      onCancel={onClose}
      okText="保存"
      cancelText="取消"
      width={640}
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ job_type: "校招", status: "开放中" }}>
        <Form.Item name="title" label="职位名称" rules={[{ required: true, message: "请填写职位名称" }]}>
          <Input placeholder="如：后端开发工程师（校招）" />
        </Form.Item>
        <Form.Item name="company" label="公司名称">
          <Input placeholder="如：字节跳动" />
        </Form.Item>
        <Form.Item name="location" label="工作地点">
          <Input placeholder="如：北京" />
        </Form.Item>
        <Form.Item name="salary" label="薪资范围">
          <Input placeholder="如：25-40K·15薪" />
        </Form.Item>
        <Form.Item name="job_type" label="岗位类型">
          <Select options={JOB_TYPE_OPTIONS} />
        </Form.Item>
        <Form.Item name="status" label="状态">
          <Select options={STATUS_OPTIONS} />
        </Form.Item>
        <Form.Item
          name="source_url"
          label="投递链接"
          rules={[{ type: "url", message: "请输入合法的 URL" }]}
        >
          <Input placeholder="招聘官网投递链接（选填）" />
        </Form.Item>
        <Form.Item name="description" label="职位描述（JD）" rules={[{ required: true, message: "请填写职位描述" }]}>
          <Input.TextArea rows={7} placeholder="粘贴完整 JD，生成简历时 AI 会据此定制内容" />
        </Form.Item>
        <Form.Item name="requirements" label="任职要求（选填）">
          <Input.TextArea rows={3} placeholder="可单独填写任职要求，没有可留空" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
