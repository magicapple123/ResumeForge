// SPDX-License-Identifier: Apache-2.0
/**
 * 备选岗位抽屉的共享常量与表单状态类型。
 * （下沉到第三文件：FormModal/CardGrid 与抽屉都要用，且禁止子文件反向 import 抽屉。）
 */

export const MAX_CANDIDATE_IMAGES = 4;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export interface FormState {
  title: string;
  company: string;
  /** 岗位链接（选填）：添加时留个"回原站看"的入口，导入岗位时预填投递链接。 */
  sourceUrl: string;
  rawText: string;
  note: string;
  images: string[];
}

export const EMPTY_FORM: FormState = {
  title: "",
  company: "",
  sourceUrl: "",
  rawText: "",
  note: "",
  images: [],
};
