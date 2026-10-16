import { CloudDownloadOutlined, LoadingOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, Space } from "antd";
import type { FormInstance } from "antd";
import { useLayoutEffect, useRef, useState } from "react";
import type { RecordFormValues } from "../../../features/settings/useLLMRecordTools";
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

interface CatalogState {
  fingerprint: string;
  loading: boolean;
  pickerOpen: boolean;
  models: string[];
  message: string;
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
      message: "",
      failed: false,
    };
    if (!String(form.getFieldValue("base_url") ?? "").trim()) {
      setState({ ...initial, failed: true, message: "请先填写 Base URL，再获取可用模型" });
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
      setState({
        ...initial,
        failed: !hasModels,
        models,
        pickerOpen: hasModels,
        message:
          result.message ||
          (hasModels
            ? `获取到 ${models.length} 个模型`
            : "没有获取到可用模型，请检查 Base URL 与 API Key 后重试；也可以手动填写模型名。"),
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
        message: error instanceof Error ? error.message : "获取模型列表失败，请重试",
      });
    } finally {
      if (pendingRequest.current === request) pendingRequest.current = null;
    }
  };

  return (
    <>
      <Form.Item
        label="模型名称"
        htmlFor="llm-record-model"
        tooltip="按当前账号获取可用模型，也可以照服务商文档手动填写模型名"
      >
        <Space.Compact block>
          <Form.Item name="model" noStyle rules={[{ required: true, message: "必填" }]}>
            <Input
              id="llm-record-model"
              aria-label="模型名称"
              placeholder="deepseek-v4-flash"
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
            获取可用模型
          </Button>
        </Space.Compact>
      </Form.Item>
      {current?.message && !current.pickerOpen && current.models.length === 0 && (
        <Alert
          type={current.failed ? "error" : "warning"}
          showIcon
          title={current.message}
          style={{ marginBottom: 16 }}
          action={
            <Button
              size="small"
              disabled={disabled || current.loading}
              onClick={() => void fetchModels()}
            >
              重试
            </Button>
          }
        />
      )}
      <ModelPickerModal
        open={open && (current?.pickerOpen ?? false)}
        modelsMessage={current?.message ?? ""}
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
