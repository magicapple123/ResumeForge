// SPDX-License-Identifier: Apache-2.0
/**
 * 从题库「带着材料开始面试」：把题目填进 setup 表单，并把岗位/简历材料交给会话。
 *
 * 为什么只取前 6 题：`focus` 字段上限 255 字，多选会把最后一道题截成半句；6 题是
 * 「够开场、又不至于被截」的经验值。
 * 材料要浅拷贝一份再存：直接存引用的话，题库页后续编辑会改到正在进行的面试。
 */
import { App } from "antd";
import type { FormInstance } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { SetupForm } from "../../pages/interview/SetupTab";
import type { QuestionBankInterviewContext } from "./useQuestionBankMaterials";

export function useQuestionBankInterview(
  form: FormInstance<SetupForm>,
  setTab: (tab: string) => void,
) {
  useLocale();
  const { message } = App.useApp();
  const [materials, setMaterials] = useState<QuestionBankInterviewContext>({});
  const startFromBank = (questions: string[], context: QuestionBankInterviewContext = {}) => {
    form.setFieldsValue({
      focus: questions.slice(0, 6).join(t("interview.listSeparator")).slice(0, 255),
      jobId: context.jobId,
      resumeId: context.resumeId,
    });
    setMaterials({
      jobMaterial: context.jobMaterial ? { ...context.jobMaterial } : null,
      resumeMaterial: context.resumeMaterial ? { ...context.resumeMaterial } : null,
    });
    setTab("session");
    message.info(t("interview.toast.questionsImported"));
  };
  return { startFromBank, materials };
}
