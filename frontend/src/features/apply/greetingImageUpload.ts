// SPDX-License-Identifier: Apache-2.0
/**
 * 配图上传前的两道闸：**是不是图片**、**是不是太大**。
 *
 * ## 为什么不能只靠 `accept="image/*"`
 *
 * `accept` 只约束「选择文件」对话框里的默认筛选，**挡不住**粘贴和拖拽：用户在聊天窗口里
 * 复制一个 PDF、或者把 `.exe` 拖进来，`File.type` 可能是 `application/pdf`、也可能是空，
 * 但文件照样会进到我们的代码里。所以必须有一步自己的判定。
 *
 * ## 为什么 MIME 与扩展名都要看
 *
 * 只砍扩展名会把浏览器给不出的 MIME（部分 Linux/移动端给空串或
 * `application/octet-stream`）误杀；只看 MIME 则挡不住"后缀是 .pdf、`type` 却是
 * `image/png` 的改名文件"。两条都过才放进上传队列，真正的格式再由后端按魔数验一遍。
 *
 * ## 为什么拒绝要给整句
 *
 * 只回一个布尔值，界面只能写"上传失败"，用户不知道是格式不对还是太大、到底该改哪一步。
 * 这里直接把**文件名 + 原因**拼成一句，组件拿到就能显示，不必再判断一次错误码。
 */
import { t } from "../../i18n";
import { formatBytes } from "../../utils/format";

/**
 * 允许的扩展名 → 规范 MIME。
 *
 * 必须与后端 `api/apply_extra._GREETING_UPLOAD_EXTENSIONS` /
 * `services/apply/greeting_image._EXTENSION_BY_MIME` 是同一份白名单：前端多收一种，
 * 后端会拒；前端少收一种，用户看着能选却传不上去。
 */
export const GREETING_IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  jfif: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** 允许的 MIME 集合（由扩展名表反推，不在两处各写一遍）。 */
export const GREETING_IMAGE_MIMES: ReadonlySet<string> = new Set(
  Object.values(GREETING_IMAGE_MIME_BY_EXTENSION),
);

/** 浏览器给不出准确类型时按"没声明"处理，交给扩展名判定。 */
const BLANK_MIMES = new Set(["", "application/octet-stream"]);

/** 拒绝的三种情形；`code` 供调用方做逻辑分支，`message` 直接拿去显示。 */
export type GreetingImageRejectionCode = "not-image" | "too-large" | "empty";

export interface GreetingImageRejection {
  code: GreetingImageRejectionCode;
  /** 已本地化的整句，含文件名（和体积）。 */
  message: string;
}

/** 取小写扩展名；没有点或点在首尾都算"没有扩展名"。 */
export function greetingImageExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/**
 * 判定一个文件能不能上传。返回 `null` 表示通过。
 *
 * `maxBytes` 由调用方从后端下发的 `max_image_bytes` 传进来（与 `services/attachments`
 * 同源）；缺省时才回落到前端镜像常量。
 */
export function validateGreetingImageFile(
  file: File,
  maxBytes: number,
): GreetingImageRejection | null {
  const name = file.name || t("applyQueue.image.unnamedFile");
  const extension = greetingImageExtension(file.name);
  const declared = (file.type || "").toLowerCase();

  // 扩展名与 MIME 必须**同时**落在白名单里；MIME 缺失时以扩展名对应的规范 MIME 为准。
  const canonical = GREETING_IMAGE_MIME_BY_EXTENSION[extension];
  const mimeOk = BLANK_MIMES.has(declared)
    ? Boolean(canonical)
    : GREETING_IMAGE_MIMES.has(declared);
  if (!canonical || !mimeOk) {
    return {
      code: "not-image",
      message: t("applyQueue.image.rejectNotImage", { name }),
    };
  }

  if (file.size === 0) {
    return { code: "empty", message: t("applyQueue.image.rejectEmpty", { name }) };
  }

  if (Number.isFinite(maxBytes) && maxBytes > 0 && file.size > maxBytes) {
    return {
      code: "too-large",
      // 两个体积都写出来：只写"超过上限"的话，用户不知道差多少、要不要压。
      message: t("applyQueue.image.rejectTooLarge", {
        name,
        size: formatBytes(file.size),
        limit: formatBytes(maxBytes),
      }),
    };
  }

  return null;
}
