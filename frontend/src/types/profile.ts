/** 个人资料及其粘贴识别结果。 */

import type { RecognitionSource } from "./common";

export interface Education {
  id?: number;
  school: string;
  /** 院系——网申表单普遍与「学校」「专业」并列单独问一项。 */
  department: string;
  major: string;
  degree: string;
  /** 全日制 / 非全日制（网申表单把"学历"拆成三个独立下拉）。 */
  study_mode: string;
  /** 学士 / 硕士 / 博士——学位类型，与 degree（学历层次）是两件事。 */
  degree_type: string;
  start_date: string;
  end_date: string;
  gpa: string;
  /** 四六级分数（这一段时间考出来的，所以录在教育经历上）。网申表单要具体分数。 */
  cet4_score: string;
  cet6_score: string;
  courses: string;
  achievements: string;
  /** 旧版本参考资料字段：仅为读取/保存旧数据兼容，当前界面不再提供入口。 */
  reference_file_name?: string;
  reference_content?: string;
}

export interface Experience {
  id?: number;
  company: string;
  role: string;
  start_date: string;
  end_date: string;
  description: string;
  /** 旧版本参考资料字段：仅为读取/保存旧数据兼容，当前界面不再提供入口。 */
  reference_file_name?: string;
  reference_content?: string;
}

export interface CampusExperience {
  id?: number;
  organization: string;
  role: string;
  start_date: string;
  end_date: string;
  description: string;
  /** 旧版本参考资料字段：仅为读取/保存旧数据兼容，当前界面不再提供入口。 */
  reference_file_name?: string;
  reference_content?: string;
}

export interface Project {
  id?: number;
  name: string;
  role: string;
  start_date: string;
  end_date: string;
  tech_stack: string;
  description: string;
  highlights: string;
  /** 旧版本参考资料字段：仅为读取/保存旧数据兼容，当前界面不再提供入口。 */
  reference_file_name?: string;
  reference_content?: string;
}

export interface Skill {
  id?: number;
  name: string;
  level: string;
}

export interface Award {
  id?: number;
  name: string;
  date: string;
  description: string;
}

export interface Profile {
  id: number;
  photo: string;
  name: string;
  gender: string;
  birth_year: string;
  phone: string;
  email: string;
  city: string;
  target_city: string;
  job_intent: string;
  personal_website: string;
  github: string;
  summary: string;
  // ===== 网申专用字段（与后端 models/profile.py 逐字对应）=====
  // 只用于「网申填表」，不进简历导出。其中 id_number 属高敏感数据。
  wechat: string;
  birth_date: string;
  id_type: string;
  id_number: string;
  country_region: string;
  native_place: string;
  political_status: string;
  phone_country_code: string;
  family_info: string;
  expected_salary: string;
  qq: string;
  advisor: string;
  research_direction: string;
  preferred_industry: string;
  section_order: string[];
  educations: Education[];
  experiences: Experience[];
  campus_experiences: CampusExperience[];
  projects: Project[];
  skills: Skill[];
  awards: Award[];
  updated_at?: string;
}

export type ProfileTextParseResult = Omit<Profile, "id" | "updated_at"> & {
  warnings: string[];
  /** 识别引擎（模型还是本地规则）。 */
  parse_engine: RecognitionSource;
  /** 图片识别时模型逐字抄录的原文；纯文本识别为空。 */
  recognized_text: string;
};
