// SPDX-License-Identifier: Apache-2.0
/**
 * 「资料里有、但没写进这份简历」的分区级清单。
 *
 * 从 types/resume.ts 拆出（那个文件贴 500 行预算）；既有导入路径由 resume.ts 的
 * re-export 保持不变。
 */

/** 一条"没写进这份简历"的分区级清单。 */
export interface ResumeCoverageNote {
  /** 资料分区键（projects/experience/...），与简历字段同名。 */
  section: string;
  section_label: string;
  /** 全部未写入的条目身份名。 */
  names: string[];
  /** 被岗位筛选/预算拦下的（没进候选资料）。 */
  filtered: string[];
  /** 进了候选但模型没写的。 */
  model_omitted: string[];
  total: number;
}
