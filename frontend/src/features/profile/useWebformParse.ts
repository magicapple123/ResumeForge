// SPDX-License-Identifier: Apache-2.0
/**
 * 「网申资料」粘贴识别的状态机（项 12 前端）。
 *
 * 为什么单独成一个 hook：`ProfilePage` 已经在 460 行上下，而这条链路自带一整套状态
 * （原文、附件、上传进度、警告、校对行）与一套取消语义。搬到页面里既挤爆预算，也会让
 * "识别"与"保存"两件事的状态混在一处。
 *
 * 三条与资料侧**刻意一致**的口径：
 * 1. 识别结果**先列成校对行**，用户确认后才写进草稿（D21/D23）；
 * 2. 取消用 `AbortController` + `isCancellation` 判，取消不是错误、不弹提示（D25）；
 * 3. 写草稿**不触发保存**：保存仍由「保存全部资料」统一提交。
 *
 * ## 为什么所有对外回调都是 `useCallback([])` + ref 读最新值
 *
 * 本 hook 的返回值里，`openModal` 会被页面的 `useMemo` 当依赖用（它进 `webFormContent`
 * 的元素引用）。回调身份**每次渲染都换新**，等于把这个 memo 打穿：页面因为击键重渲一次，
 * 整棵「网申资料」子树连同包住两个 tab 的 antd `Form` 就跟着重渲，它的 context 换新引用，
 * 「简历资料」那 67 个 `FormItem`（含 12 个日期三连选）全部被带着重渲——实测每次击键多出
 * 2 次日期字段渲染。所以这里的口径是：**对外回调的身份在整个组件生命周期里不变**，
 * 需要"最新值"的地方一律经 ref 读（ref 在 effect 里写，事件一定发生在渲染提交之后）。
 */

import { App } from "antd";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isCancellation } from "../../api/client";
import { parseWebFormExtraProfileText } from "../../api/webform";
import type { RecognitionReviewRow } from "../../components/profile/RecognitionReviewList";
import type ProfileTextModal from "../../components/profile/ProfileTextModal";
import { attachmentInputs, useRecognitionFiles } from "../../hooks/useRecognitionFiles";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import type { RecognitionSource, WebFormField } from "../../types";
import { webformToReviewRows } from "../../utils/profileText";

interface Options {
  /** 后端下发的字段目录：识别结果按它归组、排序（空目录只可能来自"还没加载完"）。 */
  fields: WebFormField[];
  /** 把校对后的行写进网申资料草稿（由页面转给 workspace 的句柄）。 */
  applyRows: (rows: RecognitionReviewRow[]) => void;
}

/** 结果为空时补的一句提示：用户需要知道"不是没反应，是真没识别到"。 */
const EMPTY_WARNING_KEY: MessageKey = "featuresMisc.webformParse.emptyWarning";

export function useWebformParse({ fields, applyRows }: Options) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [text, setTextState] = useState("");
  const [parsing, setParsing] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [recognizedText, setRecognizedText] = useState("");
  const [source, setSource] = useState<RecognitionSource | null>(null);
  const [rows, setRows] = useState<RecognitionReviewRow[] | null>(null);
  const {
    files,
    reading: filesReading,
    addFiles,
    removeFile,
    clear: clearFiles,
    onPaste: onPasteFiles,
  } = useRecognitionFiles();

  const abortRef = useRef<AbortController | null>(null);
  const requestId = useRef(0);

  /**
   * 最新的入参与状态：识别完成时读"那一刻"的值，不把它们的身份塞进回调依赖。
   *
   * `fields` / `applyRows` 来自宿主（`applyRows` 甚至是行内箭头函数，每次渲染都换新）；
   * `text` / `files` / `rows` 是本 hook 自己的 state，同样每次击键都变。全走 ref 之后，
   * 下面每个回调都可以是 `useCallback([])`——身份稳定，页面侧的 memo 才不会被击键打穿。
   *
   * ref 只在 effect 里写（渲染期写 ref 会被 react-hooks 的 Compiler 规则拦下）；事件与
   * 请求回调一定发生在渲染提交之后，读到的就是最新值。
   */
  const latestRef = useRef({ fields, applyRows, text, files, rows });
  useEffect(() => {
    latestRef.current = { fields, applyRows, text, files, rows };
  });

  /** 结果相关的四件套一起清：换了内容，上一次的来源与校对行都不再对应当前输入。 */
  const resetOutcome = useCallback(() => {
    setWarnings([]);
    setRecognizedText("");
    setSource(null);
    setRows(null);
  }, []);

  const closeModal = useCallback(() => {
    // 让在飞的请求作废：`requestId` 一加，回来的结果就认不出自己了。
    requestId.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setParsing(false);
    setUploadPercent(null);
    resetOutcome();
    clearFiles();
    setOpen(false);
  }, [clearFiles, resetOutcome]);

  /**
   * 打开弹窗。**引用必须恒定**：它是 `ProfilePage` 的 `webFormContent` memo 的依赖之一，
   * 换新一次就会让整棵「网申资料」子树重渲（进而带着「简历资料」的日期字段一起重渲）。
   */
  const openModal = useCallback(() => {
    setTextState("");
    resetOutcome();
    clearFiles();
    setOpen(true);
  }, [clearFiles, resetOutcome]);

  /** 内容改了，上一次识别的来源与校对行都不再对应当前内容。 */
  const onTextChange = useCallback(
    (value: string) => {
      setTextState(value);
      resetOutcome();
    },
    [resetOutcome],
  );

  /** 「取消识别」：只中止请求，不碰输入（用户可能想改两笔再重试）。 */
  const onCancelParse = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const onParse = useCallback(async () => {
    const { text: currentText, files: currentFiles, fields: currentFields } = latestRef.current;
    const trimmed = currentText.trim();
    if (!trimmed && currentFiles.length === 0) {
      message.warning(t("featuresMisc.webformParse.needInput"));
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setParsing(true);
    const currentId = ++requestId.current;
    setUploadPercent(0);
    try {
      const parsed = await parseWebFormExtraProfileText(
        {
          text: trimmed,
          images: attachmentInputs(currentFiles, "image"),
          documents: attachmentInputs(currentFiles, "document"),
        },
        (percent) => {
          if (currentId === requestId.current) setUploadPercent(percent);
        },
        controller.signal,
      );
      if (currentId !== requestId.current) return;
      const nextRows = webformToReviewRows(parsed.values, parsed.custom, currentFields);
      setWarnings(
        nextRows.length === 0 ? [...parsed.warnings, t(EMPTY_WARNING_KEY)] : parsed.warnings,
      );
      setRecognizedText(parsed.recognized_text ?? "");
      setSource(parsed.parse_engine);
      setRows(nextRows);
    } catch (err) {
      if (currentId !== requestId.current) return;
      // 用户自己点了「取消识别」：静默回输入态，不弹错误（这不是失败）。
      if (!isCancellation(err)) {
        resetOutcome();
        message.error(err instanceof Error ? err.message : t("featuresMisc.webformParse.failed"));
      }
    } finally {
      if (currentId === requestId.current) {
        setParsing(false);
        setUploadPercent(null);
      }
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [message, resetOutcome]);

  /** 弹窗主按钮：转成"即发即忘"的同步回调，避免把 async 函数直接挂在 `onClick` 上。 */
  const handleParse = useCallback(() => {
    void onParse();
  }, [onParse]);

  /**
   * 「确认填入」：把校对行写进草稿并关窗。
   *
   * **不保存**：写进去的只是内存草稿，保存仍由「保存全部资料」统一提交——识别与落库
   * 是两件事，用户还要在页面上核对一遍。
   */
  const onApply = useCallback(() => {
    const currentRows = latestRef.current.rows;
    if (currentRows === null) return;
    latestRef.current.applyRows(currentRows);
    closeModal();
  }, [closeModal]);

  /** 「取消」：放弃这次结果，草稿零变化。 */
  const onDiscard = useCallback(() => closeModal(), [closeModal]);

  /** 附件选择：`addFiles` 是 async，包一层把 promise 显式丢掉。 */
  const handleAddFiles = useCallback(
    (incoming: File[]) => {
      void addFiles(incoming);
    },
    [addFiles],
  );

  // `setRows` 是 useState 的 setter，身份天然稳定，直接透传。
  const modalProps = useMemo(
    () =>
      ({
        open,
        mode: "webform",
        text,
        warnings,
        parsing,
        uploadPercent,
        recognizedText,
        recognitionSource: source,
        files,
        filesReading,
        rows,
        onRowsChange: setRows,
        onApply,
        onDiscard,
        onCancelParse,
        onTextChange,
        onAddFiles: handleAddFiles,
        onRemoveFile: removeFile,
        onPasteFiles,
        onClose: closeModal,
        onParse: handleParse,
      }) satisfies ComponentProps<typeof ProfileTextModal>,
    [
      closeModal,
      files,
      filesReading,
      handleAddFiles,
      handleParse,
      onApply,
      onCancelParse,
      onDiscard,
      onPasteFiles,
      onTextChange,
      open,
      parsing,
      recognizedText,
      removeFile,
      rows,
      source,
      text,
      uploadPercent,
      warnings,
    ],
  );

  return { openModal, closeModal, modalProps };
}
