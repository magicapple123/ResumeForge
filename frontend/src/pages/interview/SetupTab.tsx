// SPDX-License-Identifier: Apache-2.0
/**
 * 面试官设定卡：类型/难度/风格/轮数/考察重点/人设，提交后由页面发起面试。
 * （自 InterviewPage 拆出：CONFIDENCE_TIP 与 SetupForm 接口随迁；form 实例由页面持有，
 * 供题库「开始模拟面试」的 startFromBank 联动写回考察重点。）
 */
import { PlayCircleOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input, Select, Space, Typography } from "antd";
import type { FormInstance } from "antd";
import { useEffect } from "react";
import type { InterviewDifficulty, InterviewType, InterviewerStyle } from "../../types";
import { useJobSearchSelect } from "../../hooks/remoteSearchOptions";
import { JANE_FACE_SOURCES } from "./janeFaces";
import {
  INTERVIEW_DIFFICULTIES,
  INTERVIEW_TYPES,
  INTERVIEWER_STYLES,
  MAX_INTERVIEW_ROUNDS,
  MIN_INTERVIEW_ROUNDS,
} from "../../types";

const CONFIDENCE_TIP =
  "面试官会基于你的资料与岗位要求提问，回答越具体（做了什么、结果是什么）点评越有用。";

/** 轮数选择框的「自动」档值：AI 按表现决定何时收尾（区间不向用户/模型展示）。 */
export const AUTO_ROUNDS_OPTION = "auto";

const ROUNDS_OPTIONS: { value: number | typeof AUTO_ROUNDS_OPTION; label: string }[] = [
  { value: AUTO_ROUNDS_OPTION, label: "自动（AI 判断收尾）" },
  ...Array.from({ length: MAX_INTERVIEW_ROUNDS - MIN_INTERVIEW_ROUNDS + 1 }, (_, index) => ({
    value: MIN_INTERVIEW_ROUNDS + index,
    label: `${MIN_INTERVIEW_ROUNDS + index} 轮`,
  })),
];

export interface SetupForm {
  jobId?: number;
  interviewType: InterviewType;
  difficulty: InterviewDifficulty;
  interviewerStyle: InterviewerStyle;
  /** 具体轮数，或 "auto" = 自动收尾（AI 按表现判断何时结束）。 */
  rounds: number | typeof AUTO_ROUNDS_OPTION;
  focus: string;
  persona: string;
}

export function SetupTab({
  form,
  initialJobId,
  starting,
  onStart,
}: {
  form: FormInstance<SetupForm>;
  /** 深链带来的预填（RF-11）：岗位详情跳过来时关联岗位已选好。
   *  id 不在候选里时由远程搜索 hook 按 id 回查补进候选（P0-1）。 */
  initialJobId?: number;
  starting: boolean;
  onStart: (values: SetupForm) => void;
}) {
  // 关联岗位下拉改为远程搜索（P0-1）：不再由页面预拉"前 100 条"当全量。
  const jobSelect = useJobSearchSelect();

  // 深链预填的岗位按 id 回查补进候选（P0-1），否则第 101 条之后的岗位只显示 id；
  // 设定卡常驻可见，挂载时同时预拉第一页候选。
  useEffect(() => {
    void jobSelect.ensure(initialJobId);
    void jobSelect.reload();
    // hook 的回调引用稳定，只跟随预填目标变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJobId]);

  return (
    <Card size="small" className="settings-card">
      <div className="jane-intro">
        <img
          className="jane-avatar jane-avatar--intro"
          src={JANE_FACE_SOURCES.idle}
          alt="面试官 Jane"
        />
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            面试官设定
          </Typography.Title>
          <Typography.Text type="secondary">你好，我是 Jane，今天由我来面试你。</Typography.Text>
        </div>
      </div>
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
          ...(initialJobId !== undefined ? { jobId: initialJobId } : {}),
        }}
        onFinish={(values) => void onStart(values)}
      >
        <div className="interview-setup-grid">
          <Form.Item label="关联岗位（选填）" name="jobId">
            <Select
              allowClear
              placeholder="选中后按该岗位的 JD 提问（输入关键词搜索）"
              {...jobSelect.selectProps}
            />
          </Form.Item>
          <Form.Item label="面试类型" name="interviewType">
            <Select options={INTERVIEW_TYPES.map((value) => ({ value, label: value }))} />
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
            <Select options={INTERVIEWER_STYLES.map((value) => ({ value, label: value }))} />
          </Form.Item>
          <Form.Item
            label="轮数"
            name="rounds"
            extra="选「自动」时不设轮数：面试官按你的表现自主决定何时收尾，更接近真实面试。"
          >
            <Select options={ROUNDS_OPTIONS} />
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
          <Button type="primary" htmlType="submit" icon={<PlayCircleOutlined />} loading={starting}>
            开始面试
          </Button>
          <Typography.Text type="secondary">{CONFIDENCE_TIP}</Typography.Text>
        </Space>
      </Form>
    </Card>
  );
}
