// SPDX-License-Identifier: Apache-2.0
/**
 * F36：岗位/简历关联在页面上的状态与出口（选中值、发送后清空、切会话清空、被引用片跳转）。
 *
 * 抽出来的原因不只是行数：这三件事必须共用同一个 `clear`，否则很容易出现"发送后清了、
 * 切会话忘了清"的漏项——对话 A 关联的岗位会跟着对话 B 的下一条消息发出去。
 *
 * T29：简历那一项的值域从 `number` 改成**复合引用串**（`internal:12` / `external:7`）。
 * 助手和提醒表单于是共用同一个选择器与同一套写法；外部简历（上传的 PDF/DOCX）也终于能
 * 在助手里被选中。两张表的 id 会撞号，所以裸数字不能再当值。
 */
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AssistantReferenceKind } from "../../../types";
import { decodeResumeRef, encodeResumeRef } from "../../../types/resumeRef";
import { positiveId } from "../assistantUtils";

export interface AssistantContextSelection {
  jobId: number | undefined;
  /** T29：已选简历的复合引用（`internal:12` / `external:7`），空 = 没选。 */
  resumeRef: string | undefined;
  setJobId: (value: number | undefined) => void;
  setResumeRef: (value: string | undefined) => void;
  /** 丢掉已选的岗位/简历（发送成功、切换或新建会话时调用）。 */
  clearContextRefs: () => void;
  /** 气泡里的引用片：跳到对应详情页。 */
  openReference: (kind: AssistantReferenceKind, id: number) => void;
}

/**
 * 深链里带进来的已选简历。
 *
 * 新写法 `?resume_ref=internal:12`；旧写法 `?resume_id=7` 按**内部简历**理解（简历页的
 * 详情抽屉至今仍写 `resume_id`）。脏值一律等于没选——不接受"半个引用"。
 */
function initialResumeRef(params: URLSearchParams): string | undefined {
  const ref = decodeResumeRef(params.get("resume_ref"));
  if (ref) return encodeResumeRef(ref);
  const id = positiveId(params.get("resume_id"));
  return id === undefined ? undefined : encodeResumeRef({ kind: "internal", id });
}

/** 深链 `?job_id=` / `?resume_ref=` 在首帧就生效，不会先空一下再跳成已选。 */
export function useAssistantContextSelection(params: URLSearchParams): AssistantContextSelection {
  const navigate = useNavigate();
  const [jobId, setJobId] = useState<number | undefined>(() => positiveId(params.get("job_id")));
  const [resumeRef, setResumeRef] = useState<string | undefined>(() => initialResumeRef(params));
  /**
   * 发送成功后清空关联选择：由流式 store 在拿到 conversationId 之后调用——建会话失败时
   * 不能把用户的选择也清掉（那等于白选一次）。
   */
  const clearContextRefs = useCallback(() => {
    setJobId(undefined);
    setResumeRef(undefined);
  }, []);
  const openReference = useCallback(
    (kind: AssistantReferenceKind, id: number) => {
      if (kind === "job") {
        navigate(`/jobs?job_id=${id}`);
        return;
      }
      // 外部简历有自己的详情页与深链参数（`?resume=`，见 `useExternalResumeDeepLink`）；
      // 拿它的 id 去开内部简历详情会打开别人的记录（两张表 id 会撞号）。
      navigate(
        kind === "external_resume" ? `/resumes/external?resume=${id}` : `/resumes?resume_id=${id}`,
      );
    },
    [navigate],
  );
  return { jobId, resumeRef, setJobId, setResumeRef, clearContextRefs, openReference };
}

/**
 * 新建 / 切换会话时先清空关联选择，再执行原动作。
 * 包一层 `useCallback`（而不是在 JSX 里写箭头函数）是因为 `ConversationSidebar` 是 memo 的：
 * 每次渲染都换引用会让整个侧栏跟着父组件重渲染。
 */
export function useContextResetOnSwitch(
  clearContextRefs: () => void,
  onCreate: () => void,
  onSelect: (id: number) => void,
) {
  const handleCreate = useCallback(() => {
    clearContextRefs();
    onCreate();
  }, [clearContextRefs, onCreate]);
  const handleSelect = useCallback(
    (id: number) => {
      clearContextRefs();
      onSelect(id);
    },
    [clearContextRefs, onSelect],
  );
  return { handleCreate, handleSelect };
}
