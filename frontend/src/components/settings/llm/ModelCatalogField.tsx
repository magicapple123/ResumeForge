// SPDX-License-Identifier: Apache-2.0
import { CloudDownloadOutlined, LoadingOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, Space } from "antd";
import type { FormInstance } from "antd";
import { useLayoutEffect, useRef, useState } from "react";
import type { RecordFormValues } from "../../../features/settings/useLLMRecordTools";
import { t, type MessageKey, type MessageParams } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { LLMModelsResult } from "../../../types";
import { ModelPickerModal } from "./ModelPickerModal";

interface Props {
  open: boolean;
  requestScope: string;
  disabled: boolean;
  form: FormInstance<RecordFormValues>;
  onFetchModels: () => Promise<LLMModelsResult>;
  onModelChange: () => void;
}

/**
 * 提示内容：后端原文原样透传（不翻译），语言包文案只存 key，渲染期再 `t()`。
 * 事件期把 `t()` 的结果写进 state 会把当时的语言冻住，切语言后这句提示不会重译。
 */
type CatalogMessage =
  { source: "backend"; text: string } | { source: "key"; key: MessageKey; params?: MessageParams };

interface CatalogState {
  fingerprint: string;
  loading: boolean;
  pickerOpen: boolean;
  models: string[];
  message: CatalogMessage | null;
  failed: boolean;
}

/** Keep catalog requests tied to the editor and credentials that initiated them. */
export default function ModelCatalogField({
  open,
  requestScope,
  disabled,
  form,
  onFetchModels,
  onModelChange,
}: Props) {
  useLocale();
  const baseUrl = Form.useWatch("base_url", form) ?? "";
  const apiKey = Form.useWatch("api_key", form) ?? "";
  const fingerprint = JSON.stringify([open, requestScope, baseUrl, apiKey]);
  const requestSequence = useRef(0);
  const pendingRequest = useRef<{ fingerprint: string; sequence: number } | null>(null);
  const [state, setState] = useState<CatalogState | null>(null);
  const current = state?.fingerprint === fingerprint ? state : null;

  const readFingerprint = () =>
    JSON.stringify([
      open,
      requestScope,
      form.getFieldValue("base_url") ?? "",
      form.getFieldValue("api_key") ?? "",
    ]);

  useLayoutEffect(() => {
    requestSequence.current += 1;
    pendingRequest.current = null;
  }, [fingerprint]);

  const fetchModels = async () => {
    const requestFingerprint = readFingerprint();
    if (
      !open ||
      disabled ||
      (pendingRequest.current !== null && pendingRequest.current.fingerprint === requestFingerprint)
    ) {
      return;
    }
    const initial: CatalogState = {
      fingerprint: requestFingerprint,
      loading: false,
      pickerOpen: false,
      models: [],
      message: null,
      failed: false,
    };
    if (!String(form.getFieldValue("base_url") ?? "").trim()) {
      setState({
        ...initial,
        failed: true,
        message: { source: "key", key: "llmUi.catalog.error.baseUrlRequired" },
      });
      form.scrollToField("base_url", { focus: true });
      return;
    }
    const request = { fingerprint: requestFingerprint, sequence: ++requestSequence.current };
    pendingRequest.current = request;
    setState({ ...initial, loading: true });
    try {
      const result = await onFetchModels();
      if (
        readFingerprint() !== requestFingerprint ||
        requestSequence.current !== request.sequence ||
        pendingRequest.current !== request
      )
        return;
      const models = result.models;
      const hasModels = models.length > 0;
      // 后端给的 message 是它自己的话，原样透传；否则才是语言包文案（存 key）。
      const nextMessage: CatalogMessage = result.message
        ? { source: "backend", text: result.message }
        : hasModels
          ? {
              source: "key",
              key: "llmUi.catalog.message.fetched",
              params: { count: models.length },
            }
          : { source: "key", key: "llmUi.catalog.message.empty" };
      setState({
        ...initial,
        failed: !hasModels,
        models,
        pickerOpen: hasModels,
        message: nextMessage,
      });
    } catch (error) {
      if (
        readFingerprint() !== requestFingerprint ||
        requestSequence.current !== request.sequence ||
        pendingRequest.current !== request
      )
        return;
      setState({
        ...initial,
        failed: true,
        message:
          error instanceof Error
            ? { source: "backend", text: error.message }
            : { source: "key", key: "llmUi.catalog.error.fetchFailed" },
      });
    } finally {
      if (pendingRequest.current === request) pendingRequest.current = null;
    }
  };

  // 提示文案在渲染期取：state 里只有 key 或后端原文，切语言后随渲染重译。
  const currentMessage = current?.message ?? null;
  const message = !currentMessage
    ? ""
    : currentMessage.source === "key"
      ? t(currentMessage.key, currentMessage.params)
      : currentMessage.text;

  return (
    <>
      <Form.Item
        label={t("llmUi.catalog.field.model")}
        htmlFor="llm-record-model"
        tooltip={t("llmUi.catalog.tooltip.model")}
      >
        <Space.Compact block>
          <Form.Item
            name="model"
            noStyle
            rules={[{ required: true, message: t("llmUi.catalog.validation.required") }]}
          >
            <Input
              id="llm-record-model"
              aria-label={t("llmUi.catalog.field.model")}
              placeholder="deepseek-flash"
              style={{ minWidth: 0, flex: 1 }}
            />
          </Form.Item>
          <Button
            icon={current?.loading ? <LoadingOutlined spin /> : <CloudDownloadOutlined />}
            aria-busy={current?.loading ?? false}
            disabled={disabled || current?.loading === true}
            style={{ flexShrink: 0 }}
            onClick={() => void fetchModels()}
          >
            {t("llmUi.catalog.action.fetch")}
          </Button>
        </Space.Compact>
      </Form.Item>
      {current?.message && !current.pickerOpen && current.models.length === 0 && (
        <Alert
          type={current.failed ? "error" : "warning"}
          showIcon
          title={message}
          style={{ marginBottom: 16 }}
          action={
            <Button
              size="small"
              disabled={disabled || current.loading}
              onClick={() => void fetchModels()}
            >
              {t("llmUi.catalog.action.retry")}
            </Button>
          }
        />
      )}
      <ModelPickerModal
        open={open && (current?.pickerOpen ?? false)}
        modelsMessage={message}
        modelOptions={current?.models ?? []}
        onPick={(model) => {
          form.setFieldValue("model", model);
          onModelChange();
        }}
        onClose={() =>
          setState((previous) => (previous ? { ...previous, pickerOpen: false } : null))
        }
      />
    </>
  );
}
