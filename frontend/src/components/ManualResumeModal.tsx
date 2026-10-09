/** 用户手写简历弹窗：用个人资料预填结构化表单，再保存为手写简历记录。 */
import { App, Modal } from "antd";
import LoadingBlock from "./common/LoadingBlock";
import { useEffect, useMemo, useRef, useState } from "react";
import { createManualResume } from "../api/resumes";
import { getProfile } from "../api/profile";
import type { Job, Profile, ResumeContent } from "../types";
import { profileToResumeContent } from "../utils/profileToResume";
import JobRequirementPanel from "./JobRequirementPanel";
import ResumeEditorModal from "./ResumeEditorModal";

interface Props {
  /** null 表示从头编写**通用简历**（不关联任何岗位）。 */
  job: Job | null;
  open: boolean;
  /** 通用简历的初始名称，留空则由后端按「姓名-自定义简历-时间」命名。 */
  initialTitle?: string;
  onClose: () => void;
}

export default function ManualResumeModal({ job, open, initialTitle = "", onClose }: Props) {
  const { message } = App.useApp();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const requestVersion = useRef(0);
  // ref 写入放 effect（Compiler 禁止渲染期写 ref）：onClose 只在异步失败回调里被读。
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const currentRequest = ++requestVersion.current;
    // 无岗位（通用简历）同样要读资料预填：这里以前会因为 !job 直接返回，
    // 导致通用简历永远打不开编辑器。
    void getProfile()
      .then((loadedProfile) => {
        if (currentRequest === requestVersion.current) setProfile(loadedProfile);
      })
      .catch((error) => {
        if (currentRequest !== requestVersion.current) return;
        message.error(error instanceof Error ? error.message : "读取个人资料失败");
        setProfile(null);
        onCloseRef.current();
      })
      .finally(() => {
        if (currentRequest === requestVersion.current) setLoading(false);
      });
  }, [open, job, message]);

  // 开/关时的状态归位（loading/profile 复位）。Compiler 规范：同步 setState 移出
  // effect，用渲染期守卫式调整（哨兵 null：挂载即打开也归位一次）；ref 失效递增
  // 留在上面的 effect 里。
  const [prevOpenSync, setPrevOpenSync] = useState<{ open: boolean; job: Job | null } | null>(null);
  if (prevOpenSync === null || prevOpenSync.open !== open || prevOpenSync.job !== job) {
    setPrevOpenSync({ open, job });
    if (!open) {
      setProfile(null);
      setLoading(false);
    } else {
      setLoading(true);
    }
  }

  const content = useMemo(
    () => (profile ? profileToResumeContent(profile, job) : null),
    [job, profile],
  );

  const save = async (nextContent: ResumeContent) => {
    await createManualResume({
      job_id: job?.id ?? null,
      title: job ? "" : initialTitle.trim(),
      content: nextContent,
    });
    message.success(
      job ? "手写简历已保存到简历中心" : "通用简历已保存，可在「我的资料」和简历中心查看",
    );
  };

  return (
    <>
      <Modal open={open && loading} footer={null} closable={false} mask={{ closable: false }}>
        <div style={{ textAlign: "center", padding: "28px 0" }}>
          <LoadingBlock />
          <div style={{ marginTop: 12 }}>正在读取我的资料…</div>
        </div>
      </Modal>
      <ResumeEditorModal
        open={open && !loading && !!content}
        content={content}
        title={job ? `自行编写「${job.title}」简历` : "从头编写通用简历"}
        description={
          job
            ? "已从我的资料预填基本信息和经历，你可以直接修改、删减或补充后保存。"
            : "已从我的资料预填基本信息和经历。通用简历不针对任何岗位，建议保留各方向的经历与技能，修改后保存。"
        }
        saveLabel="保存手写简历"
        referencePanel={job ? <JobRequirementPanel job={job} /> : undefined}
        onClose={onClose}
        onSave={save}
      />
    </>
  );
}
