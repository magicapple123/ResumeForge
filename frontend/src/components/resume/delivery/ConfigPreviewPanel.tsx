// SPDX-License-Identifier: Apache-2.0
/**
 * 「预览这份配置」（W04-config）：在导出弹层里内联展示**带水印/脱敏**的 PDF 首页产物。
 *
 * 只做三件事：按当前草稿输入请求一次预览、把 blob 放进 iframe、在失败/后端未就绪时给出路。
 * 不落库、不冻结交付；"这是配置预览，不是编辑预览"必须显式写出来（与精确预览区分）。
 */
import { Button } from "antd";
import { useEffect, useRef, useState } from "react";
import { t } from "../../../i18n";
import {
  ConfigPreviewUnsupportedError,
  previewExportConfig,
  type ConfigPreviewInput,
  type ConfigPreviewResult,
} from "../../../features/resume-delivery/configPreview";

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: ConfigPreviewResult; url: string }
  | { status: "unsupported" }
  | { status: "error" };

export interface ConfigPreviewPanelProps extends Omit<ConfigPreviewInput, "resumeId"> {
  resumeId: number | null;
  disabled?: boolean;
}

export default function ConfigPreviewPanel({
  resumeId,
  disabled = false,
  ...input
}: ConfigPreviewPanelProps) {
  const [state, setState] = useState<PreviewState>({ status: "idle" });
  const urlRef = useRef<string | null>(null);
  const requestRef = useRef(0);

  const releaseUrl = () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  };
  useEffect(
    () => () => {
      // 卸载时销毁 blob URL（卸载后再用 state 无意义，直接读 ref）。
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    },
    [],
  );

  const run = async () => {
    if (resumeId === null || state.status === "loading") return;
    const token = requestRef.current + 1;
    requestRef.current = token;
    setState({ status: "loading" });
    releaseUrl();
    try {
      const result = await previewExportConfig({ resumeId, ...input });
      if (requestRef.current !== token) return; // 过时响应（连点 / 换配置）直接丢弃
      const url = URL.createObjectURL(result.blob);
      urlRef.current = url;
      setState({ status: "ready", result, url });
    } catch (error) {
      if (requestRef.current !== token) return;
      setState({
        status: error instanceof ConfigPreviewUnsupportedError ? "unsupported" : "error",
      });
    }
  };

  const hide = () => {
    requestRef.current += 1; // 让在飞的响应回来也不再落屏
    releaseUrl();
    setState({ status: "idle" });
  };

  return (
    <section className="resume-delivery-config-preview" aria-label={t("delivery.preview.title")}>
      <div className="resume-delivery-section-head">
        <span className="resume-delivery-section-title">{t("delivery.preview.title")}</span>
        <Button
          size="small"
          type="text"
          loading={state.status === "loading"}
          disabled={disabled || resumeId === null}
          onClick={() => void run()}
        >
          {t("delivery.preview.action")}
        </Button>
      </div>
      <p className="resume-delivery-hint">{t("delivery.preview.notEditPreview")}</p>
      {state.status === "unsupported" ? (
        <p className="resume-delivery-hint" role="status">
          {t("delivery.preview.unsupported")}
        </p>
      ) : null}
      {state.status === "error" ? (
        <p className="resume-delivery-hint" role="status">
          {t("delivery.preview.failed")}
        </p>
      ) : null}
      {state.status === "ready" ? (
        <div className="resume-delivery-config-preview-body">
          <div className="resume-delivery-check-row">
            <span className="resume-delivery-hint">
              {state.result.pagesNeeded !== null && state.result.pageLimit !== null
                ? t("delivery.preview.pages", {
                    pages: state.result.pagesNeeded,
                    limit: state.result.pageLimit,
                  })
                : null}
              {state.result.overflow ? ` · ${t("delivery.preview.overflow")}` : null}
            </span>
            <Button size="small" type="link" onClick={hide}>
              {t("delivery.preview.hide")}
            </Button>
          </div>
          <iframe
            title={t("delivery.preview.title")}
            src={state.url}
            className="resume-delivery-config-preview-frame"
          />
        </div>
      ) : null}
    </section>
  );
}
