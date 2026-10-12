/** 面经的新增/编辑表单弹窗（从 InterviewExperiencePanel 拆出：面板顶着 500 行预算）。
 *
 * 表单实例由面板持有（openCreate/openEdit 需要预填字段），jobSelect 由面板传入——
 * 详情抽屉的「关联岗位」名称回查用的是同一个候选池，拆成两份会出现两套搜索状态。
 */
import { DatePicker, Form, Input, Modal, Select, Space } from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import type { FormInstance } from "antd";
import type { InterviewExperience, InterviewExperiencePayload } from "../../types";
import { EXPERIENCE_ROUND_TYPES, EXPERIENCE_SOURCES, EXPERIENCE_SOURCE_LABELS } from "../../types";
import type { useJobSearchSelect } from "../../hooks/remoteSearchOptions";

interface Props {
  open: boolean;
  /** 编辑目标（null = 新增）。 */
  editing: InterviewExperience | null;
  form: FormInstance<InterviewExperiencePayload>;
  saving: boolean;
  jobSelect: ReturnType<typeof useJobSearchSelect>;
  onCancel: () => void;
  onOk: () => void;
}

export default function InterviewExperienceFormModal({
  open,
  editing,
  form,
  saving,
  jobSelect,
  onCancel,
  onOk,
}: Props) {
  return (
    <Modal
      title={editing ? "编辑面经" : "新增面经"}
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
    >
      <Form form={form} layout="vertical" initialValues={{ source: "self" }}>
        <Form.Item label="标题" name="title">
          <Input maxLength={200} placeholder="例如：某司后端一面" />
        </Form.Item>
        <Space style={{ display: "flex" }} align="start">
          <Form.Item label="公司" name="company" style={{ flex: 1 }}>
            <Input maxLength={128} placeholder="公司名" />
          </Form.Item>
          <Form.Item label="岗位" name="position" style={{ flex: 1 }}>
            <Input maxLength={128} placeholder="岗位名" />
          </Form.Item>
        </Space>
        <Form.Item label="关联岗位（选填，删除岗位不影响面经）" name="job_id">
          <Select
            allowClear
            placeholder="绑定后自动回填公司/岗位快照（输入关键词搜索）"
            {...jobSelect.selectProps}
          />
        </Form.Item>
        <Form.Item label="正文（面试过程、怎么答的）" name="content">
          <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} placeholder="记录面试流程与心得" />
        </Form.Item>
        <Form.Item label="被问到的真实问题" name="questions" extra="逐条回车添加，会沉淀进知识库">
          <Select mode="tags" placeholder="输入后回车" open={false} suffixIcon={null} />
        </Form.Item>
        <Form.Item label="标签" name="tags">
          <Select
            mode="tags"
            placeholder="例如：客户沟通、数据透视表"
            open={false}
            suffixIcon={null}
          />
        </Form.Item>
        <Space style={{ display: "flex" }} align="start">
          <Form.Item label="来源" name="source" style={{ flex: 1 }}>
            <Select
              options={EXPERIENCE_SOURCES.map((value) => ({
                value,
                label: EXPERIENCE_SOURCE_LABELS[value],
              }))}
            />
          </Form.Item>
          <Form.Item label="难度" name="difficulty" style={{ flex: 1 }}>
            <Input maxLength={16} placeholder="例如：中等" />
          </Form.Item>
        </Space>
        <Space style={{ display: "flex" }} align="start">
          <Form.Item label="轮次" name="round_type" style={{ flex: 1 }}>
            <Select
              allowClear
              placeholder="选择常见轮次"
              options={EXPERIENCE_ROUND_TYPES.map((value) => ({ value, label: value }))}
            />
          </Form.Item>
          <Form.Item
            label="面试日期"
            name="interview_date"
            style={{ flex: 1 }}
            getValueProps={(value: string) => ({ value: value ? dayjs(value) : null })}
            normalize={(value: Dayjs | null) => (value ? value.format("YYYY-MM-DD") : "")}
          >
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
        </Space>
      </Form>
    </Modal>
  );
}
