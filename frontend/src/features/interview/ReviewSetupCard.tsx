// SPDX-License-Identifier: Apache-2.0
/** 面试复盘第一步：录入真实被问的问题 + 关联岗位 + 简历来源。
 *
 * 从 InterviewReviewPanel 拆出（Q3）。拆的原因不是"文件太长"，而是复盘要同时支持**内部
 * 简历 / 外部简历 / 导入文件**三种来源，光这一块的状态与控件就占满了原来的设定卡预算。
 *
 * 简历这一块刻意**复用现成件**，不另造一套：
 * - `useInterviewResumeSelect`（内部 + 外部分组下拉，value 带 `r:` / `e:` 前缀，外部简历
 *   没有正文时在候选里就禁用）；
 * - `MaterialSourceField`（导出即解析，选完文件当场看到读取了多少字）。
 *
 * 两者的分工与「面试设置」那一页完全一致：下拉管记录、`MaterialSourceField` 管文件。
 * 差别只有一个——复盘不需要岗位/简历**都**必填，所以这里不做表单校验，缺什么由面板在
 * 提交那一刻给一句能照做的提示。
 */
import { SendOutlined } from "@ant-design/icons";
import { Button, Card, Input, Select, Space, Typography } from "antd";
import type { ReactNode } from "react";
import AbortButton from "../../components/common/AbortButton";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { useInterviewResumeSelect } from "../../hooks/useInterviewResumeSelect";
import type { useJobSearchSelect } from "../../hooks/remoteSearchOptions";
import type { InterviewMaterialExtract } from "../../types";
import {
  MaterialSourceField,
  type MaterialSourceMode,
} from "../../pages/interview/MaterialSourceField";

/**
 * 简历来源控件：记录侧下拉（内部 + 外部分组）+ 导入文件。
 *
 * 放在本文件里而不是单独一个文件：它只服务这一张卡与下方那张「答题思路」卡（历史查看态
 * 也要能补选简历），拆成第三个文件反而是噪音。
 */
export function ReviewResumeField({
  mode,
  material,
  select,
  value,
  disabled,
  onModeChange,
  onMaterialChange,
}: {
  mode: MaterialSourceMode;
  material: InterviewMaterialExtract | null;
  select: ReturnType<typeof useInterviewResumeSelect>;
  /** 下拉里当前的值（`r:1` / `e:7`）；来源切到文件时为 undefined。 */
  value: string | undefined;
  disabled: boolean;
  onModeChange: (mode: MaterialSourceMode) => void;
  onMaterialChange: (material: InterviewMaterialExtract | null) => void;
}) {
  // 模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  return (
    <Space orientation="vertical" style={{ width: "100%" }} size={6}>
      <Typography.Text strong>{t("interviewReview.resume.label")}</Typography.Text>
      {mode === "record" && (
        <Select
          allowClear
          style={{ width: "100%", minWidth: 220 }}
          placeholder={t("interviewReview.placeholder.resume")}
          value={value}
          {...select.selectProps}
        />
      )}
      {/* 与面试设置页同一个组件：来源开关 + 上传即解析 + 常驻警告条。 */}
      <MaterialSourceField
        kind="resume"
        mode={mode}
        material={material}
        disabled={disabled}
        onModeChange={onModeChange}
        onMaterialChange={onMaterialChange}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("interviewReview.resume.hint")}
      </Typography.Text>
    </Space>
  );
}

export default function ReviewSetupCard({
  question,
  onQuestionChange,
  jobSelect,
  jobId,
  onJobChange,
  resumeField,
  analyzing,
  onAnalyze,
  onAbort,
}: {
  question: string;
  onQuestionChange: (value: string) => void;
  jobSelect: ReturnType<typeof useJobSearchSelect>;
  jobId?: number;
  onJobChange: (jobId: number | undefined) => void;
  /** 简历来源控件（状态在面板里，两个卡片共用同一份）。 */
  resumeField: ReactNode;
  analyzing: boolean;
  onAnalyze: () => void;
  onAbort: () => void;
}) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  return (
    <Card size="small" title={t("interviewReview.card.setup")}>
      <Space orientation="vertical" style={{ width: "100%" }} size={8}>
        <Input.TextArea
          value={question}
          autoSize={{ minRows: 2, maxRows: 4 }}
          placeholder={t("interviewReview.placeholder.question")}
          onChange={(event) => onQuestionChange(event.target.value)}
        />
        <Select
          allowClear
          style={{ minWidth: 220, maxWidth: 420 }}
          placeholder={t("interviewReview.placeholder.job")}
          value={jobId}
          onChange={onJobChange}
          {...jobSelect.selectProps}
        />
        {resumeField}
        <Space wrap>
          <Button type="primary" icon={<SendOutlined />} loading={analyzing} onClick={onAnalyze}>
            {t("interviewReview.action.analyze")}
          </Button>
          {analyzing && <AbortButton onClick={onAbort} />}
        </Space>
      </Space>
    </Card>
  );
}
