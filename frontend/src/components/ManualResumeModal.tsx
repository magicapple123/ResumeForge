// SPDX-License-Identifier: Apache-2.0
/** 用户手写简历弹窗：岗位模式预填基本信息，通用模式从空白开始（可一键填入全部资料）。 */
import { App, Input, Modal } from "antd";
import LoadingBlock from "./common/LoadingBlock";
import { useEffect, useMemo, useRef, useState } from "react";
import { createManualResume } from "../api/resumes";
import { getProfile } from "../api/profile";
import type { Job, Profile, ResumeContent } from "../types";
import { blankResumeContent, profileToResumeContent } from "../utils/profileToResume";
import { buildProfileFillSources } from "../features/profile/profileFillOptions";
import { bumpResumeList } from "../features/resume/resumeListEvents";
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
  /**
   * 简历名称（项 11）：输入框从「我的资料」页的通用简历区块搬进了编辑器顶部。
   *
   * 页面上那个常驻输入框的问题是"不点开编辑器也得先想名字"，而真正会用到它的地方
   * 是编辑器内部。这里与 `initialTitle` 保持兼容：打开时以它为初值，用户可以改。
   */
  const [title, setTitle] = useState(initialTitle);
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
      // 每次打开都从初始名称重新开始：上一次改了一半的名字不该留到下一份简历。
      setTitle(initialTitle);
    }
  }

  /**
   * 初始内容。
   *
   * - **岗位详情里的「自行编写」**（`job != null`）：只预填**基本信息**。经历/项目/技能这些
   *   是"这个岗位要什么"，只能由用户照着岗位要求亲手写；把资料里所有经历一股脑倒进来，
   *   用户得先删掉一大半，而且很容易留下与岗位无关的段落。留空 + 每个模块顶部的
   *   「从我的资料追加一条」= 需要哪条就加哪条。
   * - **通用手写简历**（`job == null`）：**从空白开始**（T11）。以前是全量预填，但那份
   *   简历不针对任何岗位，资料里所有经历都是候选，用户同样得先删一半才写得下去。
   *   现在改成"空白起步 + 头部一键填入全部资料"：要么自己写这一份需要的，要么一次带入。
   */
  const content = useMemo(() => {
    if (!profile) return null;
    const base = profileToResumeContent(profile, job);
    if (!job) return blankResumeContent();
    return {
      ...base,
      summary: "",
      education: [],
      experience: [],
      campus_experience: [],
      projects: [],
      skills: [],
      awards: [],
    };
  }, [job, profile]);
  // 「从我的资料填入」的候选：预填之后用户又在资料里补了实习/项目时，不必复制粘贴。
  // 只在有资料时构造；`ResumeDetailPreview` 的编辑入口不传（那里改的是已保存简历）。
  const fillSources = useMemo(() => (profile ? buildProfileFillSources(profile) : null), [profile]);

  const save = async (nextContent: ResumeContent) => {
    await createManualResume({
      job_id: job?.id ?? null,
      title: job ? "" : title.trim(),
      content: nextContent,
    });
    // T12：保存成功就广播。列表由订阅方各自重取——「我的资料」的通用简历区块、简历中心，
    // 以及以后新增的入口，都不必再各自记着"保存完要 reload"。
    bumpResumeList();
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
        // 草稿作用域必须带岗位维度：这里不传 `resumeId`，只按 id 分槽会让所有岗位共用
        // `resume.edit#new`——在岗位 A 放弃修改后打开岗位 B，B 会看到 A 的草稿。
        // 通用简历（无岗位）仍走缺省槽：它本来就只有一份。
        draftScopeKey={job ? `resume.edit#new@job-${job.id}` : undefined}

        // 项 11：名称输入搬进编辑器顶部（原来是页面上一个常驻输入框）。
        // 岗位模式不需要它——标题由后端按岗位命名。
        headerExtra={
          job ? undefined : (
            <Input
              aria-label="简历名称"
              value={title}
              maxLength={64}
              placeholder="简历名称（留空自动命名）"
              onChange={(event) => setTitle(event.target.value)}
              style={{ maxWidth: 360, marginBottom: 12 }}
            />
          )
        }
        description={
          job
            ? "已预填基本信息；其他模块留空，可用每个模块里的「从我的资料追加一条」按需添加。"
            : "从空白开始；可点「填入我的资料全部数据」一次带入，也可以只写这一份需要的内容。"
        }
        saveLabel="保存手写简历"
        referencePanel={job ? <JobRequirementPanel job={job} /> : undefined}
        fillSources={fillSources}
        // 岗位模式只留模块顶部的「追加一条」：条目是用户照岗位亲手加出来的，
        // 头部再摆"填入本条"既没有对应目标，也和顶部入口抢同一件事。
        entryFill={!job}
        // T11：通用模式才给「填入我的资料全部数据」。岗位模式不传——那份表单的经历
        // 是照岗位写的，一键把资料全倒进去等于替用户做决定。
        fillAll={job || !profile ? undefined : () => profileToResumeContent(profile)}
        onClose={onClose}
        onSave={save}
      />
    </>
  );
}
