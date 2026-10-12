/** 个人资料接口。 */
import type {
  ExtractionDocumentInput,
  ExtractionImageInput,
  Profile,
  ProfileTextParseResult,
} from "../types";
import { request, uploadWithProgress } from "./client";

export function getProfile(): Promise<Profile> {
  return request("/profile");
}

export function saveProfile(profile: Omit<Profile, "id" | "updated_at">): Promise<Profile> {
  return request("/profile", { method: "PUT", body: JSON.stringify(profile) });
}

/**
 * 资料/简历识别（多文档 + 截图 base64 JSON）。附件随 JSON 一起发，大文件下请求体
 * 可达数 MB——走 XHR 进度上传（onProgress 报 0-100），让弹窗能画出上传进度条。
 * 预算仍是 recognition 档（90s，含服务端识别时间）。
 */
export function parseProfileText(
  payload: {
    text: string;
    images?: ExtractionImageInput[];
    documents?: ExtractionDocumentInput[];
  },
  onProgress?: (percent: number) => void,
): Promise<ProfileTextParseResult> {
  return uploadWithProgress("/profile/parse-text", JSON.stringify(payload), {
    budget: "recognition",
    onProgress,
  });
}
