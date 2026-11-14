// SPDX-License-Identifier: Apache-2.0
/**
 * 题库里的「岗位 / 简历」两块材料：岗位只从记录选（Q3），简历是记录或导入文件。
 *
 * 数据与选中状态都在 `useQuestionBankMaterials` 里（题库、面试两处共用同一份），这里只负责
 * 排布。简历侧只有 `source === "record"` 才渲染下拉：否则会出现「上边选了记录、下边还留着
 * 上次粘贴的文本」，用户分不清哪份会被用。
 *
 * 岗位侧不再有「导入文件」：岗位的正经入口是岗位广场按链接导入，再给一个上传 JD 的入口
 * 只会让同一件事有两个入口（`allowFile={false}` 把整块来源开关去掉）。
 */
import { Select, Space, Typography } from "antd";
import { MaterialSourceField } from "../../pages/interview/MaterialSourceField";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { useQuestionBankMaterials } from "./useQuestionBankMaterials";

export default function QuestionBankMaterialBar({
  materials,
  disabled,
}: {
  materials: ReturnType<typeof useQuestionBankMaterials>;
  disabled: boolean;
}) {
  useLocale();
  return (
    <div className="interview-setup-materials" style={{ marginBottom: 12 }}>
      <Space orientation="vertical" style={{ width: "100%" }}>
        <Typography.Text strong>{t("interviewPage.setup.jobLabel")}</Typography.Text>
        <Select
          allowClear
          style={{ width: "100%", minWidth: 240 }}
          placeholder={t("questionBankPanel.select.jobPlaceholder")}
          value={materials.jobId}
          onChange={materials.setJobId}
          disabled={disabled || undefined}
          {...materials.jobSelect.selectProps}
        />
        <MaterialSourceField
          kind="job"
          mode="record"
          material={null}
          disabled={disabled || undefined}
          allowFile={false}
          onModeChange={() => undefined}
          onMaterialChange={() => undefined}
        />
      </Space>
      <Space orientation="vertical" style={{ width: "100%" }}>
        <Typography.Text strong>{t("interviewPage.setup.resumeLabel")}</Typography.Text>
        {materials.resumeSource === "record" && (
          <Select
            allowClear
            style={{ width: "100%", minWidth: 240 }}
            placeholder={t("questionBankPanel.select.resumePlaceholder")}
            value={materials.resumeValue}
            disabled={disabled || undefined}
            {...materials.resumeSelect.selectProps}
          />
        )}
        <MaterialSourceField
          kind="resume"
          mode={materials.resumeSource}
          material={materials.resumeMaterial}
          disabled={disabled || undefined}
          onModeChange={materials.setResumeSource}
          onMaterialChange={materials.setResumeMaterial}
        />
      </Space>
    </div>
  );
}
