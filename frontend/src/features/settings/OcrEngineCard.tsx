// SPDX-License-Identifier: Apache-2.0
/**
 * 「识别引擎」设置卡（T01 的三档设置项）：自动 / 只用 OCR / 只用视觉模型。
 *
 * ## 为什么三档的说明文字由后端给
 *
 * `GET /api/ocr/settings` 一次返回 `engine_options[].label`，每档那句"原件发给谁、按什么
 * 计费"就写在里面。前端**不再写一份中文**：档位的语义属于后端策略（`services/ocr/policy.py`），
 * 两处各写一份，后端改了语义而界面还在讲旧话，是最难被发现的那类漂移。
 *
 * ## 为什么"只用 OCR 且没有 Key"必须明说会报错
 *
 * 用户明确选了"只用 OCR"，此时静默回落到视觉模型等于把原件发给另一家第三方，还顺带
 * 花掉视觉模型的 token。所以这里如实写：会报错，不会偷偷换服务商（与后端
 * `OcrContext.ocr_required` 的行为一致）。
 *
 * Key 不在这张卡里填：它复用联网搜索的 DeepSeek Key（本页「搜索来源」那一组）。
 */

import { Alert, Card, Flex, Radio, Typography } from "antd";
import ErrorState from "../../components/common/ErrorState";
import LoadingBlock from "../../components/common/LoadingBlock";
import { useCallback, useEffect, useState } from "react";
import { getOcrSettings, saveOcrEngine } from "../../api/connections";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useToast } from "../../hooks/useToast";
import type { OcrEngine, OcrSettings } from "../../types";

export default function OcrEngineCard() {
  useLocale();
  const toast = useToast();
  const [settings, setSettings] = useState<OcrSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);

  // 取数（供「重试」按钮复用）：只做 IO 与 setState，由调用方决定什么时候跑。
  const load = useCallback(async (): Promise<void> => {
    try {
      setSettings(await getOcrSettings());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("ocrEngine.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  // 挂载加载走内联 async IIFE：`setState` 在回调里应用，不在 effect 体里（Compiler 规范）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await getOcrSettings();
        if (cancelled) return;
        setSettings(loaded);
        setError("");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("ocrEngine.loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const change = async (engine: OcrEngine): Promise<void> => {
    if (busy || engine === settings?.engine) return;
    setBusy(true);
    setFailure("");
    try {
      setSettings(await saveOcrEngine(engine));
      toast.success(t("ocrEngine.saved"));
    } catch (err) {
      // 保存失败时保持界面上原来那档：受控组件不能先乐观改再回滚，否则用户会以为改成了。
      setFailure(err instanceof Error ? err.message : t("ocrEngine.loadFailed"));
    } finally {
      setBusy(false);
    }
  };

  const currentLabel =
    settings?.engine_options.find((option) => option.value === settings.engine)?.label ??
    settings?.engine ??
    "";

  return (
    <Card title={t("ocrEngine.title")} className="settings-card">
      <Alert type="info" showIcon title={t("ocrEngine.intro")} style={{ marginBottom: 16 }} />

      {error ? (
        <div style={{ marginBottom: 16 }}>
          <ErrorState
            description={t("connections.loadErrorBody", { message: error })}
            onRetry={() => {
              setLoading(true);
              void load();
            }}
            retryLabel={t("common.retry")}
          />
        </div>
      ) : null}

      <LoadingBlock spinning={loading}>
        {settings ? (
          <Flex vertical gap={12}>
            <Radio.Group
              aria-label={t("ocrEngine.title")}
              value={settings.engine}
              onChange={(event) => void change(event.target.value as OcrEngine)}
              disabled={busy || undefined}
            >
              <Flex vertical gap={8}>
                {settings.engine_options.map((option) => (
                  <Radio key={option.value} value={option.value}>
                    {option.label}
                  </Radio>
                ))}
              </Flex>
            </Radio.Group>

            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("ocrEngine.current", { label: currentLabel })}
            </Typography.Text>

            {/* 没 Key 时把"会怎样"写清楚，而不是等用户选完再看一次失败。 */}
            {settings.key_configured ? null : (
              <Alert
                type="warning"
                showIcon
                title={t("ocrEngine.keyMissing.title")}
                description={t("ocrEngine.keyMissing.body")}
              />
            )}

            {failure ? (
              <Alert
                type="error"
                showIcon
                title={t("ocrEngine.saveFailed", { message: failure })}
              />
            ) : null}
          </Flex>
        ) : null}
      </LoadingBlock>
    </Card>
  );
}
