// SPDX-License-Identifier: Apache-2.0
/**
 * 面试官设定卡：类型/难度/风格/轮数/考察重点/人设，提交后由页面发起面试。
 * （自 InterviewPage 拆出：SetupForm 接口随迁，提示语改由语言包
 * `interviewPage.setup.confidenceTip` 提供；form 实例由页面持有，
 * 供题库「开始模拟面试」的 startFromBank 联动写回考察重点。）
 */
import { PlayCircleOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input, Select, Space, Typography } from "antd";
import type { FormInstance } from "antd";
import { useEffect } from "react";
import type { InterviewDifficulty, InterviewType, InterviewerStyle } from "../../types";
import { useJobSearchSelect } from "../../hooks/remoteSearchOptions";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { JANE_FACE_SOURCES } from "./janeFaces";
import {
  INTERVIEW_DIFFICULTIES,
  INTERVIEW_TYPES,
  INTERVIEWER_STYLES,
  MAX_INTERVIEW_ROUNDS,
  MIN_INTERVIEW_ROUNDS,
} from "../../types";

/**
 * 面试类型 / 难度 / 面试官风格的显示名：**键是协议值**（提交给后端并原样入库，
 * `types/interview.ts` 的白名单一个字都没动），值指向语言包 key。
 *
 * 模块作用域不能调 `t()`（切语言不会重渲染），所以这里只存 key，渲染处再取。
 */
const INTERVIEW_TYPE_LABEL_KEYS: Record<InterviewType, MessageKey> = {
  技术面: "interviewPage.setup.type.technical",
  项目深挖: "interviewPage.setup.type.project",
  "行为面（STAR）": "interviewPage.setup.type.behavioral",
  "HR 面": "interviewPage.setup.type.hr",
  综合面: "interviewPage.setup.type.general",
  案例分析: "interviewPage.setup.type.case",
  英语面试: "interviewPage.setup.type.english",
  压力面: "interviewPage.setup.type.stress",
};

const INTERVIEW_DIFFICULTY_LABEL_KEYS: Record<InterviewDifficulty, MessageKey> = {
  初级: "interviewPage.setup.difficulty.junior",
  中级: "interviewPage.setup.difficulty.mid",
  高级: "interviewPage.setup.difficulty.senior",
};

const INTERVIEWER_STYLE_LABEL_KEYS: Record<InterviewerStyle, MessageKey> = {
  严谨专业: "interviewPage.setup.style.rigorous",
  温和引导: "interviewPage.setup.style.gentle",
  持续追问: "interviewPage.setup.style.probing",
  压力质询: "interviewPage.setup.style.pressure",
};

/** 轮数选择框的「自动」档值：AI 按表现决定何时收尾（区间不向用户/模型展示）。 */
export const AUTO_ROUNDS_OPTION = "auto";

const ROUNDS_OPTIONS: { value: number | typeof AUTO_ROUNDS_OPTION; labelKey: MessageKey }[] = [
  { value: AUTO_ROUNDS_OPTION, labelKey: "interviewPage.setup.roundsAuto" },
  ...Array.from({ length: MAX_INTERVIEW_ROUNDS - MIN_INTERVIEW_ROUNDS + 1 }, (_, index) => ({
    value: MIN_INTERVIEW_ROUNDS + index,
    labelKey: "interviewPage.setup.roundsOption" as const,
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
  // 本卡用模块级 t()：必须订阅语言变化，否则切语言后表单文案不重渲染。
  useLocale();
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
          alt={t("interviewPage.avatarAlt")}
        />
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            {t("interviewPage.setup.title")}
          </Typography.Title>
          <Typography.Text type="secondary">{t("interviewPage.setup.greeting")}</Typography.Text>
        </div>
      </div>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          // 默认「综合面」而不是「技术面」：技术面只是其中一种类型，
          // 把它当默认会让非技术岗的用户每次都要先改一次。
          // 下面三个初始值是提交给后端的协议值（不随语言变），显示名走上面那张映射表。
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
          <Form.Item label={t("interviewPage.setup.jobLabel")} name="jobId">
            <Select
              allowClear
              placeholder={t("interviewPage.setup.jobPlaceholder")}
              {...jobSelect.selectProps}
            />
          </Form.Item>
          <Form.Item label={t("interviewPage.setup.typeLabel")} name="interviewType">
            <Select
              options={INTERVIEW_TYPES.map((value) => ({
                value,
                label: t(INTERVIEW_TYPE_LABEL_KEYS[value]),
              }))}
            />
          </Form.Item>
          <Form.Item label={t("interviewPage.setup.difficultyLabel")} name="difficulty">
            <Select
              options={INTERVIEW_DIFFICULTIES.map((value) => ({
                value,
                label: t(INTERVIEW_DIFFICULTY_LABEL_KEYS[value]),
              }))}
            />
          </Form.Item>
          <Form.Item label={t("interviewPage.setup.styleLabel")} name="interviewerStyle">
            <Select
              options={INTERVIEWER_STYLES.map((value) => ({
                value,
                label: t(INTERVIEWER_STYLE_LABEL_KEYS[value]),
              }))}
            />
          </Form.Item>
          <Form.Item
            label={t("interviewPage.setup.roundsLabel")}
            name="rounds"
            extra={t("interviewPage.setup.roundsExtra")}
          >
            {/* 「自动」档的文案不含 {round}，多传的参数不会被替换。 */}
            <Select
              options={ROUNDS_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.labelKey, { round: option.value }),
              }))}
            />
          </Form.Item>
          <Form.Item
            label={t("interviewPage.setup.focusLabel")}
            name="focus"
            extra={t("interviewPage.setup.focusExtra")}
          >
            <Input maxLength={255} placeholder={t("interviewPage.setup.focusPlaceholder")} />
          </Form.Item>
        </div>
        <Form.Item
          label={t("interviewPage.setup.personaLabel")}
          name="persona"
          extra={t("interviewPage.setup.personaExtra")}
        >
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} maxLength={2000} />
        </Form.Item>
        <Space wrap>
          <Button type="primary" htmlType="submit" icon={<PlayCircleOutlined />} loading={starting}>
            {t("interviewPage.setup.start")}
          </Button>
          <Typography.Text type="secondary">
            {t("interviewPage.setup.confidenceTip")}
          </Typography.Text>
        </Space>
      </Form>
    </Card>
  );
}
