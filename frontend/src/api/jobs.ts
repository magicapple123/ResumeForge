/** 岗位相关接口。 */
import type { Job, JobPayload, Page, ScrapeResult, SourceInfo } from "../types";
import { buildQuery, request } from "./client";

export interface JobListParams {
  keyword?: string;
  source?: string;
  job_type?: string;
  status?: string;
  page?: number;
  page_size?: number;
}

export function listJobs(params: JobListParams = {}): Promise<Page<Job>> {
  return request(`/jobs${buildQuery(params)}`);
}

export function getJob(id: number): Promise<Job> {
  return request(`/jobs/${id}`);
}

export function createJob(payload: JobPayload): Promise<Job> {
  return request("/jobs", { method: "POST", body: JSON.stringify(payload) });
}

export function updateJob(id: number, payload: Partial<JobPayload>): Promise<Job> {
  return request(`/jobs/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function deleteJob(id: number): Promise<void> {
  return request(`/jobs/${id}`, { method: "DELETE" });
}

export function listSources(): Promise<SourceInfo[]> {
  return request("/jobs/meta/sources");
}

export function scrapeJobs(payload: {
  source: string;
  keyword?: string;
  limit?: number;
}): Promise<ScrapeResult> {
  return request("/jobs/scrape", { method: "POST", body: JSON.stringify(payload) });
}
