/**
 * 面试官设定卡：类型/难度/风格/轮数/考察重点/人设，提交后由页面发起面试。
 * （自 InterviewPage 拆出：CONFIDENCE_TIP 与 SetupForm 接口随迁；form 实例由页面持有，
 * 供题库「开始模拟面试」的 startFromBank 联动写回考察重点。）
 */
import { PlayCircleOutlined } from "@ant-design/icons";
import { Card, Form, Input, InputNumber, Select, Space, Typography } from "antd";
import type { FormInstance } from "antd";
import type { InterviewDifficulty, InterviewType, InterviewerStyle } from "../../types";
import {
  INTERVIEW_DIFFICULTIES,
  INTERVIEW_TYPES,
  INTERVIEWER_STYLES,
  MAX_INTERVIEW_ROUNDS,
  MIN_INTERVIEW_ROUNDS,
} from "../../types";

const CONFIDENCE_TIP =
  "面试官会基于你的资料与岗位要求提问，回答越具体（做了什么、结果是什么）点评越有用。";

export interface SetupForm {
  jobId?: number;
  interviewType: InterviewType;
  difficulty: InterviewDifficulty;
  interviewerStyle: InterviewerStyle;
  rounds: number;
  focus: string;
  persona: string;
}

export function SetupTab({
  form,
  jobOptions,
  starting,
  onStart,
}: {
  form: FormInstance<SetupForm>;
  jobOptions: { value: number; label: string }[];
  starting: boolean;
  onStart: (values: SetupForm) => void;
}) {
  return (
    <Card size="small" className="settings-card">
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        面试官设定
      </Typography.Title>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          // 默认「综合面」而不是「技术面」：技术面只是其中一种类型，
          // 把它当默认会让非技术岗的用户每次都要先改一次。
          interviewType: "综合面",
          difficulty: "中级",
          interviewerStyle: "严谨专业",
          rounds: 6,
          focus: "",
          persona: "",
        }}
        onFinish={(values) => void onStart(values)}
      >
        <div className="interview-setup-grid">
          <Form.Item label="关联岗位（选填）" name="jobId">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="选中后按该岗位的 JD 提问"
              options={jobOptions}
            />
          </Form.Item>
          <Form.Item label="面试类型" name="interviewType">
            <Select
              options={INTERVIEW_TYPES.map((value) => ({ value, label: value }))}
            />
          </Form.Item>
          <Form.Item label="难度" name="difficulty">
            <Select
              options={INTERVIEW_DIFFICULTIES.map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
          <Form.Item label="面试官风格" name="interviewerStyle">
            <Select
              options={INTERVIEWER_STYLES.map((value) => ({ value, label: value }))}
            />
          </Form.Item>
          <Form.Item
            label="轮数"
            name="rounds"
            extra={`${MIN_INTERVIEW_ROUNDS}-${MAX_INTERVIEW_ROUNDS} 轮`}
          >
            <InputNumber
              min={MIN_INTERVIEW_ROUNDS}
              max={MAX_INTERVIEW_ROUNDS}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item
            label="考察重点（选填）"
            name="focus"
            extra="例如：用户增长、跨部门协作、成本控制"
          >
            <Input maxLength={255} placeholder="留空则按面试类型通用考察" />
          </Form.Item>
        </div>
        <Form.Item
          label="自定义面试官人设（选填）"
          name="persona"
          extra="例如：某公司业务负责人，喜欢追问具体数字与落地过程。优先级高于上面的默认风格。"
        >
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} maxLength={2000} />
        </Form.Item>
        <Space wrap>
          <Button
            type="primary"
            htmlType="submit"
            icon={<PlayCircleOutlined />}
            loading={starting}
          >
            开始面试
          </Button>
          <Typography.Text type="secondary">{CONFIDENCE_TIP}</Typography.Text>
        </Space>
      </Form>
    </Card>
  );
}
