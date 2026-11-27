// SPDX-License-Identifier: Apache-2.0
/**
 * 配图上传这一小段被两处复用（设置页的单选、队列编辑的多选），抽成一个 hook。
 *
 * ## 一条上传路径
 *
 * 「选择文件」与「粘贴截图」最终都走 :func:`useGreetingImageUpload` 返回的 `uploadMany`：
 * 校验（格式 / 体积）→ 上传 → 逐张回报。两套入口各自写一遍的话，迟早出现"选择能拦住
 * 8 MB、粘贴放过去"这种只在某一条路径上才复现的问题。
 *
 * ## 为什么校验放在上传**之前**
 *
 * 超过上限的图传到一半才被后端 400，用户等了一整次往返才知道要重来，而本地其实已经知道
 * `file.size`。上限值由调用方传入（来自 `GET /apply/greeting-image` 的 `max_image_bytes`，
 * 后端常量 `services/attachments.MAX_ATTACHMENT_BYTES` 是唯一权威），前端不另立数字。
 *
 * ## 为什么逐张回报
 *
 * 一次粘 3 张、第 2 张格式不对时，整批判失败会让第 1、3 张白传；逐张给结果，成功的已经
 * 进库，失败的那张带着原因留在调用方手里，可以原地重试。
 */
import { App } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { uploadGreetingImage } from "../../api/applyExtras";
import { t } from "../../i18n";
import type { ApplyGreetingImageOption } from "../../types";
import { MAX_ATTACHMENT_BYTES } from "../../utils/attachments";
import { validateGreetingImageFile } from "./greetingImageUpload";

/** 单张文件的结果：成功带 `option`，失败带可读的 `reason`（含文件名）。 */
export interface GreetingImageUploadOutcome {
  file: File;
  option: ApplyGreetingImageOption | null;
  reason: string | null;
}

export interface GreetingImageUploader {
  uploading: boolean;
  /** 上传一张；成功后交给 `onUploaded`，失败返回 `null`。 */
  upload: (file: File) => Promise<ApplyGreetingImageOption | null>;
  /** 批量上传（粘贴可能一次给出多张）；逐张返回结果，**不会**因为某一张失败而中断。 */
  uploadMany: (files: File[]) => Promise<GreetingImageUploadOutcome[]>;
}

/**
 * @param onUploaded 每成功一张就回调一次（调用方决定"选中"的语义：单选 vs 追加）。
 * @param maxBytes 单张上限，来自后端下发值；缺省回落到与后端同值的镜像常量。
 */
export function useGreetingImageUpload(
  onUploaded: (option: ApplyGreetingImageOption) => void,
  maxBytes: number = MAX_ATTACHMENT_BYTES,
): GreetingImageUploader {
  const { message } = App.useApp();
  const [uploading, setUploading] = useState(false);
  // 回调进 ref：上传函数因此不必随父组件的每次渲染重建（否则 antd Upload 会重挂）。
  // 只在渲染之后同步（`useEffect`），不在渲染期写 ref——后者会让 React 的并发渲染读到半更新值。
  const uploadedRef = useRef(onUploaded);
  useEffect(() => {
    uploadedRef.current = onUploaded;
  });

  const uploadOne = useCallback(
    async (file: File): Promise<GreetingImageUploadOutcome> => {
      // 第一道闸在本地：格式不对 / 太大，连请求都不发。
      const rejection = validateGreetingImageFile(file, maxBytes);
      if (rejection) return { file, option: null, reason: rejection.message };
      try {
        const option = await uploadGreetingImage(file);
        uploadedRef.current(option);
        return { file, option, reason: null };
      } catch (error) {
        // 后端文案（"这张图片超过 N MB"、409 之类）比"上传失败"具体，优先用它。
        const detail = error instanceof Error && error.message ? error.message : "";
        const reason = detail || t("applyQueue.image.uploadFailed");
        return {
          file,
          option: null,
          reason: t("applyQueue.image.uploadFailedNamed", { name: file.name, reason }),
        };
      }
    },
    [maxBytes],
  );

  const uploadMany = useCallback(
    async (files: File[]): Promise<GreetingImageUploadOutcome[]> => {
      const list = files.filter(Boolean);
      if (list.length === 0) return [];
      setUploading(true);
      try {
        // 顺序传：提示与结果的顺序要和用户"粘进去 / 选进来"的顺序一致，并发会乱序。
        const outcomes: GreetingImageUploadOutcome[] = [];
        for (const file of list) outcomes.push(await uploadOne(file));

        const succeeded = outcomes.filter((item) => item.option !== null).length;
        if (succeeded > 0) {
          message.success(
            succeeded === 1
              ? t("applyQueue.image.uploaded")
              : t("applyQueue.image.uploadedBatch", { count: succeeded }),
          );
        }
        // 每张失败各给一条：只报"有 N 张失败"的话，用户还得自己猜是哪张、为什么。
        for (const outcome of outcomes) {
          if (outcome.reason) message.error(outcome.reason);
        }
        return outcomes;
      } finally {
        setUploading(false);
      }
    },
    [message, uploadOne],
  );

  const upload = useCallback(
    async (file: File): Promise<ApplyGreetingImageOption | null> => {
      const [outcome] = await uploadMany([file]);
      return outcome?.option ?? null;
    },
    [uploadMany],
  );

  return { uploading, upload, uploadMany };
}

/**
 * 监听文档级 `paste`：剪贴板里带文件就交给 `onFiles`。
 *
 * 三条边界：
 * 1. **纯文本粘贴不拦**——招呼语输入框里贴一段文字时，`files` 为空，这里什么都不做；
 * 2. 输入框里"既有文字又有图"的粘贴（从 Word 复制）也放行给输入框，否则文字会被吞掉；
 * 3. `preventDefault` 只在真的接管了文件时调用，避免和浏览器默认行为打架。
 */
export function useGreetingImagePaste(onFiles: (files: File[]) => void, enabled = true): void {
  const handlerRef = useRef(onFiles);
  useEffect(() => {
    handlerRef.current = onFiles;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const handlePaste = (event: ClipboardEvent): void => {
      const clipboard = event.clipboardData;
      const files = clipboard ? Array.from(clipboard.files ?? []) : [];
      if (files.length === 0) return;

      const target = event.target instanceof HTMLElement ? event.target : null;
      const editable = target?.closest("input, textarea, [contenteditable='true']");
      // 在可编辑控件里粘贴"带文字"的内容：让输入框自己处理，别抢。
      if (editable && clipboard?.getData("text/plain")) return;

      event.preventDefault();
      handlerRef.current(files);
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [enabled]);
}
