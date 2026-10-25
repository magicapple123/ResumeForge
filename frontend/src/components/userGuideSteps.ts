// SPDX-License-Identifier: Apache-2.0
/** 使用指南门面：只做类型再导出与步骤组装（数据按领域拆在 ./user-guide/ 下）。
 *
 * 应用内说明书 = 新用户唯一会主动打开的文档；docs/user-guide.md 更全，但没人会在装好
 * 应用之前去读它。因此用户可见的新功能要么写进这里，要么在 docs/user-guide.md 里说明
 * 为什么不必写；判据是"用户会不会因为不知道而用错或用不上"。
 *
 * 写作口径（改文案时请守住）：一条只说一件事，text 一句话；lead 是扫读锚点；
 * 正文强调用两个星号包住，渲染时会变成粗体。
 */
import type { GuideStep } from "./user-guide/guideTypes";
import { ASSISTANT_STEPS } from "./user-guide/assistantSteps";
import { DATA_BACKUP_STEPS } from "./user-guide/dataBackupSteps";
import { RESUME_STEPS } from "./user-guide/resumeSteps";
import { SETUP_PROFILE_STEPS } from "./user-guide/setupProfileSteps";
import { WORKFLOW_STEPS } from "./user-guide/workflowSteps";

export type { GuidePoint, GuideStep } from "./user-guide/guideTypes";

export const GUIDE_STEPS: GuideStep[] = [
  ...SETUP_PROFILE_STEPS,
  ...WORKFLOW_STEPS,
  ...RESUME_STEPS,
  ...ASSISTANT_STEPS,
  ...DATA_BACKUP_STEPS,
];
