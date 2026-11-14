// SPDX-License-Identifier: Apache-2.0
/**
 * F36：岗位/简历关联在页面上的状态与出口（选中值、发送后清空、切会话清空、被引用片跳转）。
 *
 * 抽出来的原因不只是行数：这三件事必须共用同一个 `clear`，否则很容易出现"发送后清了、
 * 切会话忘了清"的漏项——对话 A 关联的岗位会跟着对话 B 的下一条消息发出去。
 */
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AssistantReferenceKind } from "../../../types";
import { positiveId } from "../assistantUtils";

export interface AssistantContextSelection {
  jobId: number | undefined;
  resumeId: number | undefined;
  setJobId: (value: number | undefined) => void;
  setResumeId: (value: number | undefined) => void;
  /** 丢掉已选的岗位/简历（发送成功、切换或新建会话时调用）。 */
  clearContextRefs: () => void;
  /** 气泡里的引用片：跳到对应详情页。 */
  openReference: (kind: AssistantReferenceKind, id: number) => void;
}

/** 深链 `?job_id=` / `?resume_id=` 在首帧就生效，不会先空一下再跳成已选。 */
export function useAssistantContextSelection(params: URLSearchParams): AssistantContextSelection {
  const navigate = useNavigate();
  const [jobId, setJobId] = useState<number | undefined>(() => positiveId(params.get("job_id")));
  const [resumeId, setResumeId] = useState<number | undefined>(() =>
    positiveId(params.get("resume_id")),
  );
  /**
   * 发送成功后清空关联选择：由流式 store 在拿到 conversationId 之后调用——建会话失败时
   * 不能把用户的选择也清掉（那等于白选一次）。
   */
  const clearContextRefs = useCallback(() => {
    setJobId(undefined);
    setResumeId(undefined);
  }, []);
  const openReference = useCallback(
    (kind: AssistantReferenceKind, id: number) => {
      navigate(kind === "job" ? `/jobs?job_id=${id}` : `/resumes?resume_id=${id}`);
    },
    [navigate],
  );
  return { jobId, resumeId, setJobId, setResumeId, clearContextRefs, openReference };
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
