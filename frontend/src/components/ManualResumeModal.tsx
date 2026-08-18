/** 用户手写简历弹窗：用个人资料预填结构化表单，再保存为手写简历记录。 */
import { App, Modal, Spin } from "antd";
import { useEffect, useMemo, useState } from "react";
import { createManualResume } from "../api/resumes";
import { getProfile } from "../api/profile";
import type {
  Profile,
  ResumeContent,
  ResumeEducation,
  ResumeExperience,
  ResumeProject,
} from "../types";
import type { Job } from "../types";
import ResumeEditorModal from "./ResumeEditorModal";

interface Props {
  job: Job | null;
  onClose: () => void;
}

const splitLines = (value: string | undefined): string[] =>
  (value ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

const splitTechStack = (value: string | undefined): string[] =>
  (value ?? "")
    .split(/[\r\n,，、;；|]+/)
    .map((item) => item.trim())
    .filter(Boolean);

function hasText(value: Record<string, unknown>): boolean {
  return Object.values(value).some((item) => {
    if (Array.isArray(item)) return item.length > 0;
    return typeof item === "string" && item.trim().length > 0;
  });
}

/** 将资料页的多行字符串转换为简历编辑器使用的数组字段。 */
function profileToResumeContent(profile: Profile, job?: Job | null): ResumeContent {
  const education: ResumeEducation[] = profile.educations
    .map((item) => ({
      school: item.school,
      major: item.major,
      degree: item.degree,
      start_date: item.start_date,
      end_date: item.end_date,
      gpa: item.gpa,
      courses: splitLines(item.courses),
      achievements: splitLines(item.achievements),
    }))
    .filter((item) => hasText(item as unknown as Record<string, unknown>));
  const experience: ResumeExperience[] = profile.experiences
    .map((item) => ({
      company: item.company,
      role: item.role,
      start_date: item.start_date,
      end_date: item.end_date,
      description: splitLines(item.description),
    }))
    .filter((item) => hasText(item as unknown as Record<string, unknown>));
  const campus_experience = profile.campus_experiences
    .map((item) => ({
      organization: item.organization,
      role: item.role,
      start_date: item.start_date,
      end_date: item.end_date,
      description: splitLines(item.description),
    }))
    .filter((item) => hasText(item as unknown as Record<string, unknown>));
  const projects: ResumeProject[] = profile.projects
    .map((item) => ({
      name: item.name,
      role: item.role,
      start_date: item.start_date,
      end_date: item.end_date,
      tech_stack: splitTechStack(item.tech_stack),
      description: splitLines(item.description),
      highlights: splitLines(item.highlights),
    }))
    .filter((item) => hasText(item as unknown as Record<string, unknown>));

  return {
    photo: profile.photo,
    name: profile.name,
    gender: profile.gender,
    birth_year: profile.birth_year,
    phone: profile.phone,
    email: profile.email,
    city: profile.city,
    job_intent: profile.job_intent || job?.title || "",
    summary: profile.summary,
    education,
    experience,
    campus_experience,
    projects,
    skills: profile.skills
      .map((item) => ({ name: item.name, level: item.level }))
      .filter((item) => hasText(item)),
    awards: profile.awards
      .map((item) => ({ name: item.name, date: item.date, description: item.description }))
      .filter((item) => hasText(item)),
  };
}

export default function ManualResumeModal({ job, onClose }: Props) {
  const { message } = App.useApp();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!job) {
      setProfile(null);
      return;
    }
    setLoading(true);
    void getProfile()
      .then(setProfile)
      .catch((error) => {
        message.error(error instanceof Error ? error.message : "读取个人资料失败");
        setProfile(null);
        onClose();
      })
      .finally(() => setLoading(false));
  }, [job, message, onClose]);

  const content = useMemo(
    () => (profile ? profileToResumeContent(profile, job) : null),
    [job, profile],
  );

  const save = async (nextContent: ResumeContent) => {
    await createManualResume({ job_id: job?.id ?? null, content: nextContent });
    message.success("手写简历已保存到简历中心");
  };

  return (
    <>
      <Modal open={!!job && loading} footer={null} closable={false} maskClosable={false} centered>
        <div style={{ textAlign: "center", padding: "28px 0" }}>
          <Spin />
          <div style={{ marginTop: 12 }}>正在读取我的资料…</div>
        </div>
      </Modal>
      <ResumeEditorModal
        open={!!job && !loading && !!content}
        content={content}
        title={job ? `自行编写「${job.title}」简历` : "自行编写简历"}
        description="已从我的资料预填基本信息和经历，你可以直接修改、删减或补充后保存。"
        saveLabel="保存手写简历"
        onClose={onClose}
        onSave={save}
      />
    </>
  );
}
