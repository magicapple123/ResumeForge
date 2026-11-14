// SPDX-License-Identifier: Apache-2.0
/**
 * 面试设置里的**简历**材料状态：每来一份新的题库快照只应用一次，之后普通重渲染保留用户编辑。
 *
 * 用「上一次的快照引用」判断新快照：用 id 或内容哈希都可能在同一 id 重新生成时漏掉。
 * `resumeFileOrigin` 区分「用户选的本地文件」与「从外部简历导入」，决定上传走哪条路径。
 *
 * 岗位侧不再有材料状态（Q3：岗位只从记录选），所以这里只剩简历一侧。
 */
import { useState } from "react";
import type { InterviewMaterialExtract } from "../../types";
import type { MaterialSourceMode } from "./MaterialSourceField";

/** Apply each new resume snapshot once; unrelated renders preserve subsequent user edits. */
export function useSetupMaterials(initialResumeMaterial?: InterviewMaterialExtract | null) {
  const [resumeSource, setResumeSource] = useState<MaterialSourceMode>(
    initialResumeMaterial ? "file" : "record",
  );
  const [resumeMaterial, setResumeMaterial] = useState<InterviewMaterialExtract | null>(
    initialResumeMaterial ?? null,
  );
  const [resumeFileOrigin, setResumeFileOrigin] = useState<"file" | "external" | null>(
    initialResumeMaterial ? "file" : null,
  );
  const [previous, setPrevious] = useState(initialResumeMaterial);
  if (previous !== initialResumeMaterial) {
    setPrevious(initialResumeMaterial);
    if (initialResumeMaterial !== undefined) {
      setResumeSource(initialResumeMaterial ? "file" : "record");
      setResumeMaterial(initialResumeMaterial);
      setResumeFileOrigin(initialResumeMaterial ? "file" : null);
    }
  }
  return {
    resumeSource,
    setResumeSource,
    resumeMaterial,
    setResumeMaterial,
    resumeFileOrigin,
    setResumeFileOrigin,
  };
}
