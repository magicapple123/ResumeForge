// SPDX-License-Identifier: Apache-2.0
/** 求职助手附件读取、容量预留和待发送状态。 */

import { App } from "antd";
import type { RefObject } from "react";
import { useCallback, useRef, useState } from "react";
import { t } from "../../../i18n";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_BYTES,
  classifyAttachment,
  readAsDataUrl,
  type PendingAttachment,
} from "../assistantUtils";

interface Options {
  mountedRef: RefObject<boolean>;
}

export function useAssistantAttachments({ mountedRef }: Options) {
  const { message } = App.useApp();
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentReads, setAttachmentReads] = useState(0);
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  const attachmentSequenceRef = useRef(0);
  const attachmentReadsRef = useRef(0);
  const attachmentUsageRef = useRef({ count: 0, bytes: 0 });

  const clearAttachments = useCallback(() => {
    attachmentsRef.current = [];
    attachmentUsageRef.current = { count: attachmentReadsRef.current, bytes: 0 };
    setAttachments([]);
  }, []);

  const removeAttachment = useCallback((attachmentId: number) => {
    const attachment = attachmentsRef.current.find((item) => item.id === attachmentId);
    if (!attachment) return;
    const next = attachmentsRef.current.filter((item) => item.id !== attachmentId);
    attachmentsRef.current = next;
    attachmentUsageRef.current = {
      count: Math.max(attachmentReadsRef.current, attachmentUsageRef.current.count - 1),
      bytes: Math.max(0, attachmentUsageRef.current.bytes - attachment.size),
    };
    setAttachments(next);
  }, []);

  const addAttachment = useCallback(
    async (file: File) => {
      const classification = classifyAttachment(file);
      if (!classification) {
        message.warning(t("assistantHooks.attachments.warning.unsupported"));
        return;
      }
      if (attachmentUsageRef.current.count >= MAX_ATTACHMENT_COUNT) {
        message.warning(
          t("assistantHooks.attachments.warning.tooMany", { count: MAX_ATTACHMENT_COUNT }),
        );
        return;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        message.warning(
          t("assistantHooks.attachments.warning.tooLarge", {
            size: MAX_ATTACHMENT_BYTES / 1024 / 1024,
          }),
        );
        return;
      }
      if (attachmentUsageRef.current.bytes + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
        message.warning(
          t("assistantHooks.attachments.warning.totalTooLarge", {
            size: MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024,
          }),
        );
        return;
      }
      attachmentUsageRef.current = {
        count: attachmentUsageRef.current.count + 1,
        bytes: attachmentUsageRef.current.bytes + file.size,
      };
      attachmentReadsRef.current += 1;
      setAttachmentReads((current) => current + 1);
      try {
        // 只有纯文本文件读成字符串；图片和文档都必须带原始字节（文档在后端提取文字）。
        const data = classification.kind === "text" ? await file.text() : await readAsDataUrl(file);
        if (!mountedRef.current) return;
        const attachment: PendingAttachment = {
          id: ++attachmentSequenceRef.current,
          name: file.name,
          mime_type: classification.mimeType,
          data,
          size: file.size,
          kind: classification.kind,
        };
        const next = [...attachmentsRef.current, attachment];
        attachmentsRef.current = next;
        setAttachments(next);
      } catch (error) {
        attachmentUsageRef.current = {
          count: Math.max(0, attachmentUsageRef.current.count - 1),
          bytes: Math.max(0, attachmentUsageRef.current.bytes - file.size),
        };
        message.error(
          error instanceof Error ? error.message : t("assistantHooks.attachments.error.read"),
        );
      } finally {
        attachmentReadsRef.current = Math.max(0, attachmentReadsRef.current - 1);
        if (mountedRef.current) setAttachmentReads((current) => Math.max(0, current - 1));
      }
    },
    [message, mountedRef],
  );

  return {
    attachments,
    attachmentsRef,
    attachmentReads,
    attachmentReadsRef,
    clearAttachments,
    removeAttachment,
    addAttachment,
  };
}
