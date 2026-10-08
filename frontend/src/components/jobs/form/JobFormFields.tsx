/** 岗位表单的静态字段（职位名称 → 备注）。
 *
 * 零 props：Form.Item 经 Form context 注册到 JobFormModal 持有的同一个 form 实例。
 */
import { DatePicker, Form, Input, Select } from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { HintedTextArea } from "../../common/MaxLengthHint";
import { JOB_TYPE_OPTIONS, STATUS_OPTIONS } from "./jobFormOptions";

export default function JobFormFields() {
  return (
    <>
      <Form.Item
        name="title"
        label="职位名称"
        rules={[{ required: true, message: "请填写职位名称" }]}
      >
        <Input placeholder="如：市场营销专员（校招）" />
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
      <Form.Item
        name="posted_at"
        label="发布时间（选填）"
        // DatePicker 值走 Dayjs，但 JobPayload.posted_at 是字符串：getValueProps 把存的
        // 字符串转成 Dayjs 给控件，normalize 再把 Dayjs 转回 YYYY-MM-DD 存进表单。
        getValueProps={(value: string) => ({ value: value ? dayjs(value) : null })}
        normalize={(value: Dayjs | null) => (value ? value.format("YYYY-MM-DD") : "")}
      >
        <DatePicker style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item
        name="description"
        label="职位描述（JD）"
        rules={[{ required: true, message: "请填写职位描述" }]}
      >
        <HintedTextArea
          rows={7}
          maxLength={20000}
          placeholder="粘贴完整 JD，生成简历时 AI 会据此定制内容"
        />
      </Form.Item>
      <Form.Item name="requirements" label="任职要求（选填）">
        <Input.TextArea rows={3} placeholder="可单独填写任职要求，没有可留空" />
      </Form.Item>
      <Form.Item name="additional_info" label="其他招聘信息（选填）">
        <Input.TextArea
          rows={4}
          placeholder="如：公司与团队介绍、职位编号、福利待遇、工作安排、申请或面试流程"
        />
      </Form.Item>
      <Form.Item name="note" label="备注（选填）">
        <HintedTextArea
          rows={3}
          maxLength={2000}
          placeholder="记录投递进展、内推联系人、面试安排等；保存时会自动补一行「来源：…」"
        />
      </Form.Item>
    </>
  );
}
