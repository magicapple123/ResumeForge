/** 面经知识库接口。 */
import type { InterviewExperience, InterviewExperiencePayload } from "../types";
import { buildQuery, request } from "./client";

export interface ExperienceListParams {
  keyword?: string;
  company?: string;
  source?: string;
  limit?: number;
}

export function listInterviewExperiences(
  params: ExperienceListParams = {},
): Promise<InterviewExperience[]> {
  return request(`/interview-experiences${buildQuery(params)}`);
}

export function getInterviewExperience(id: number): Promise<InterviewExperience> {
  return request(`/interview-experiences/${id}`);
}

export function createInterviewExperience(
  payload: InterviewExperiencePayload,
): Promise<InterviewExperience> {
  return request("/interview-experiences", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateInterviewExperience(
  id: number,
  payload: InterviewExperiencePayload,
): Promise<InterviewExperience> {
  return request(`/interview-experiences/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteInterviewExperience(id: number): Promise<void> {
  return request(`/interview-experiences/${id}`, { method: "DELETE" });
}

/** 批量移入回收站（软删除）：与简历批量删除同一口径，后端缺失任一 id 即整体 404。 */
export function batchDeleteInterviewExperiences(
  experienceIds: number[],
): Promise<{ deleted: number }> {
  return request("/interview-experiences/batch-delete", {
    method: "POST",
    body: JSON.stringify({ experience_ids: experienceIds }),
  });
}
