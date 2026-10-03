/**
 * 备选岗位抽屉的共享常量与表单状态类型。
 * （下沉到第三文件：FormModal/CardGrid 与抽屉都要用，且禁止子文件反向 import 抽屉。）
 */

export const MAX_CANDIDATE_IMAGES = 4;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export interface FormState {
  title: string;
  company: string;
  rawText: string;
  note: string;
  images: string[];
}

export const EMPTY_FORM: FormState = { title: "", company: "", rawText: "", note: "", images: [] };
