// SPDX-License-Identifier: Apache-2.0
/**
 * 远程搜索选择器的开箱即用工厂（P0-1）：把岗位 / 简历 / 进度三类高频下拉的
 * 取数、标签拼装与已选值回查统一封装，替代各页 `page_size: 100` 当全量的旧取法。
 *
 * 各页曾经的标签口径保留不变：
 * - 岗位：`标题 · 公司`（无公司时只有标题）
 * - 简历：标题（缺省 `简历 #id`）
 * - 进度：`公司 · 岗位`
 */
import { getJob, listJobs } from "../api/jobs";
import { getResume, listResumes } from "../api/resumes";
import { getTrack, listTracksPage } from "../api/tracker";
import { useRemoteSearchSelect } from "./useRemoteSearchSelect";
import type { RemoteSelectOption } from "./useRemoteSearchSelect";

/** 下拉搜索的每页条数：搜索结果足够扫一眼，翻找靠继续输入关键词。 */
const SELECT_PAGE_SIZE = 50;

export function jobOption(job: { id: number; title: string; company: string }): RemoteSelectOption {
  return { value: job.id, label: `${job.title}${job.company ? ` · ${job.company}` : ""}` };
}

export function resumeOption(resume: { id: number; title: string }): RemoteSelectOption {
  return { value: resume.id, label: resume.title || `简历 #${resume.id}` };
}

export function trackOption(track: {
  id: number;
  company: string;
  title: string;
}): RemoteSelectOption {
  return { value: track.id, label: `${track.company} · ${track.title}` };
}

export function useJobSearchSelect() {
  return useRemoteSearchSelect({
    fetchOptions: (keyword) =>
      listJobs({ keyword, page_size: SELECT_PAGE_SIZE }).then((page) => page.items.map(jobOption)),
    fetchById: (id) =>
      getJob(id)
        .then(jobOption)
        .catch(() => null),
  });
}

export function useResumeSearchSelect() {
  return useRemoteSearchSelect({
    fetchOptions: (keyword) =>
      listResumes({ keyword, page_size: SELECT_PAGE_SIZE }).then((page) =>
        page.items.map(resumeOption),
      ),
    fetchById: (id) =>
      getResume(id)
        .then(resumeOption)
        .catch(() => null),
  });
}

/**
 * 简历远程搜索（限定某岗位，P0-1）：投递队列条目的简历选择用——
 * 候选只给该岗位关联过的简历，不把全库简历混进来。
 */
export function useResumeSearchSelectForJob(jobId: number | null) {
  return useRemoteSearchSelect({
    fetchOptions: (keyword) =>
      listResumes({ job_id: jobId ?? undefined, keyword, page_size: SELECT_PAGE_SIZE }).then(
        (page) => page.items.map(resumeOption),
      ),
    fetchById: (id) =>
      getResume(id)
        .then(resumeOption)
        .catch(() => null),
  });
}

export function useTrackSearchSelect() {
  return useRemoteSearchSelect({
    fetchOptions: (keyword) =>
      listTracksPage({ keyword }, 1, SELECT_PAGE_SIZE).then((page) => page.items.map(trackOption)),
    fetchById: (id) =>
      getTrack(id)
        .then(trackOption)
        .catch(() => null),
  });
}
