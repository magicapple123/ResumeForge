/**
 * 候选 → 正式岗位表单的预填值。
 *
 * **为什么需要它**：候选有两条来路，它们的字段分布正好相反——手工粘贴的只有 ``raw_text``
 * （采不到的结构化字段一个没有），而采集来的恰恰相反，内容全在 ``description`` /
 * ``requirements`` / ``location`` 这些列里，``raw_text`` 是空的。
 *
 * 之前「导入到岗位」只预填 ``raw_text``，于是**采集来的候选打开的是一个全空的表单**：
 * 用户看到的就是"导入进来什么都没有"，而数据其实一直都在候选里。
 *
 * 空值一律不带上（``JobFormModal`` 那边也是这么处理的）：把空串显式写进表单会让
 * "这个字段是空的"与"这个字段没被填过"分不开。
 */
import type { CandidateJobDetail, JobPayload } from "../../../types";

export function candidateToJobPayload(candidate: CandidateJobDetail): Partial<JobPayload> {
  const payload: Partial<JobPayload> = {
    title: candidate.title,
    company: candidate.company,
    location: candidate.location,
    salary: candidate.salary,
    job_type: candidate.job_type,
    source_url: candidate.source_url,
    description: candidate.description,
    requirements: candidate.requirements,
    additional_info: candidate.additional_info,
    note: candidate.note,
  };
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== "" && value != null),
  ) as Partial<JobPayload>;
}
