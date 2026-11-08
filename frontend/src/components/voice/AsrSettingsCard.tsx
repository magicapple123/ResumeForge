// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「语音转写」卡片：服务地址 + 模型 + API Key，保存 / 测试连接 / 清除 Key。
 *
 * 为什么单独一张卡：语音走独立的 OpenAI 兼容 /audio/transcriptions 服务（DeepSeek
 * 没有这个能力），地址与 Key 都不跟大模型配置共用。卡片自带取数与保存（与 SearchCard
 * 同一套形态），不参与设置页的全局"编辑态"。
 *
 * Key 的显示口径：已保存时输入框里是 ********（后端回显掩码），原样保存会保留旧 Key；
 * 留空同样保留；只有点「清除已保存的 Key」才真的删除（发送 __clear__ 哨兵）。
 * 换服务地址时后端会丢弃旧 Key——不把上一家服务商的 Key 发给新主机。
 */

import { App, Alert, Button, Card, Input, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import LoadingBlock from "../common/LoadingBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import {
  CLEAR_ASR_KEY,
  getAsrSettings,
  providerHostOf,
  saveAsrSettings,
  testAsrSettings,
  type AsrSettings,
} from "./asrApi";

const EMPTY_SETTINGS: AsrSettings = {
  base_url: "",
  api_key: "",
  model: "",
  configured: false,
};

export default function AsrSettingsCard() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切到英文后这张卡仍是中文。
  useLocale();
  const { message } = App.useApp();
  const [form, setForm] = useState<AsrSettings>(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Compiler 规范：挂载加载用内联 async IIFE（setState 在自身回调里应用）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await getAsrSettings();
        if (!cancelled) setForm(saved);
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : t("voiceInput.settings.loadFailed"),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = (changes: Partial<AsrSettings>) => {
    setForm((current) => ({ ...current, ...changes }));
    // 改了字段之后旧的连接测试结论就不作数了，别让"连接成功"停在错的地址旁边。
    setTestResult(null);
  };

  const payloadOf = (apiKey: string) => ({
    base_url: form.base_url.trim(),
    api_key: apiKey,
    model: form.model.trim(),
  });

  const save = async () => {
    setSaving(true);
    try {
      setForm(await saveAsrSettings(payloadOf(form.api_key)));
      message.success(t("voiceInput.settings.saved"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("voiceInput.settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testAsrSettings(payloadOf(form.api_key));
      setTestResult({ ok: result.ok, message: result.message });
    } catch (error) {
      setTestResult({
        ok: false,
        message: error instanceof Error ? error.message : t("voiceInput.settings.testFailed"),
      });
    } finally {
      setTesting(false);
    }
  };

  const clearKey = async () => {
    setSaving(true);
    try {
      setForm(
        await saveAsrSettings({
          base_url: form.base_url.trim(),
          api_key: CLEAR_ASR_KEY,
          model: form.model.trim(),
        }),
      );
      message.success(t("voiceInput.settings.key.cleared"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("voiceInput.settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const host = providerHostOf(form.base_url);

  return (
    <Card title={t("voiceInput.settings.title")} className="settings-card">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("voiceInput.settings.intro")}
      </Typography.Paragraph>

      {loadError ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title={t("voiceInput.settings.loadErrorTitle")}
          description={t("voiceInput.settings.loadErrorBody", { message: loadError })}
        />
      ) : null}

      <LoadingBlock spinning={loading}>
        <Space orientation="vertical" size="large" style={{ width: "100%" }}>
          <div>
            <Typography.Text strong>{t("voiceInput.settings.baseUrl.label")}</Typography.Text>
            <Input
              aria-label={t("voiceInput.settings.baseUrl.aria")}
              value={form.base_url}
              onChange={(event) => patch({ base_url: event.target.value })}
              placeholder={t("voiceInput.settings.baseUrl.placeholder")}
              autoComplete="off"
              allowClear
            />
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              {t("voiceInput.settings.baseUrl.hint")}
            </Typography.Paragraph>
          </div>

          <div>
            <Typography.Text strong>{t("voiceInput.settings.model.label")}</Typography.Text>
            <Input
              aria-label={t("voiceInput.settings.model.aria")}
              value={form.model}
              onChange={(event) => patch({ model: event.target.value })}
              placeholder={t("voiceInput.settings.model.placeholder")}
              autoComplete="off"
            />
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              {t("voiceInput.settings.model.hint")}
            </Typography.Paragraph>
          </div>

          <div>
            <Typography.Text strong>{t("voiceInput.settings.key.label")}</Typography.Text>
            <Input.Password
              aria-label={t("voiceInput.settings.key.aria")}
              value={form.api_key}
              onChange={(event) => patch({ api_key: event.target.value })}
              placeholder={t("voiceInput.settings.key.placeholder")}
              autoComplete="off"
            />
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 8 }}>
              {t("voiceInput.settings.key.hint")}
            </Typography.Paragraph>
            {form.api_key ? (
              <Button size="small" danger loading={saving} onClick={() => void clearKey()}>
                {t("voiceInput.settings.key.clear")}
              </Button>
            ) : null}
          </div>

          <Space wrap>
            <Button type="primary" loading={saving} onClick={() => void save()}>
              {t("voiceInput.settings.save")}
            </Button>
            <Button loading={testing} onClick={() => void test()}>
              {testing ? t("voiceInput.settings.testing") : t("voiceInput.settings.test")}
            </Button>
            <Tag color={form.configured ? "green" : undefined}>
              {form.configured
                ? t("voiceInput.settings.badge.configured")
                : t("voiceInput.settings.badge.notConfigured")}
            </Tag>
          </Space>

          {testResult ? (
            <Alert type={testResult.ok ? "success" : "error"} showIcon title={testResult.message} />
          ) : null}

          <div>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
              {t("voiceInput.settings.limitHint")}
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
              {t("voiceInput.settings.providerNote")}
            </Typography.Paragraph>
            {form.configured && host ? (
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                {t("voiceInput.settings.privacyNote", { host })}
              </Typography.Paragraph>
            ) : null}
          </div>
        </Space>
      </LoadingBlock>
    </Card>
  );
}
