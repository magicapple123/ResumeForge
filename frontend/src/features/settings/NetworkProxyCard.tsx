// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「出网与代理」卡（T02 / T05）。
 *
 * 为什么需要这张卡：改造前"用不用代理"只能改系统环境变量并重启。这台机器装了 Clash 而
 * 模型连不上时，用户手里**没有任何可以按的按钮**，错误文案也只会说「无法连接模型服务」。
 *
 * 三条边界（都是可观察的）：
 * - 三档里「直连」是唯一会让用户"自己把自己断网"的开关，所以它带一条一直可见的警示，
 *   并且**默认不选**（默认跟随系统）；
 * - 「信任系统证书库」默认关：打开等于承认这台机器上任何被系统信任的中间人证书都可信；
 * - 检测到代理时只挂一条**可关闭**的提示，不弹窗、不阻断。
 */
import { App, Alert, Button, Card, Flex, Input, Radio, Space, Switch, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { getLLMConfig, testLLM } from "../../api/settings";
import {
  getNetworkSettings,
  saveNetworkSettings,
  type NetworkSettings,
  type ProxyMode,
} from "../../api/settingsNetwork";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** 提示条的关闭状态按机器存：代理是机器级属性，不跨设备同步。 */
const NOTICE_DISMISSED_KEY = "rf.network.proxyNoticeDismissed.v1";

interface ProbeLine {
  label: string;
  ok: boolean;
  message: string;
}

export default function NetworkProxyCard() {
  useLocale();
  const { message } = App.useApp();
  const [data, setData] = useState<NetworkSettings | null>(null);
  const [mode, setMode] = useState<ProxyMode>("system");
  const [proxyUrl, setProxyUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [trust, setTrust] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeLines, setProbeLines] = useState<ProbeLine[] | null>(null);
  const [noticeDismissed, setNoticeDismissed] = useState(
    () => localStorage.getItem(NOTICE_DISMISSED_KEY) === "1",
  );

  const apply = useCallback((next: NetworkSettings) => {
    setData(next);
    setMode(next.proxy_mode);
    setProxyUrl(next.proxy_url);
    setUsername(next.proxy_username);
    setPassword("");
    setTrust(next.trust_system_certs);
  }, []);

  useEffect(() => {
    void getNetworkSettings()
      .then(apply)
      .catch(() => setData(null));
  }, [apply]);

  const save = async () => {
    setSaving(true);
    try {
      const next = await saveNetworkSettings({
        proxy_mode: mode,
        proxy_url: proxyUrl,
        proxy_username: username,
        proxy_password: password,
        trust_system_certs: trust,
      });
      apply(next);
      message.success(t("settingsUi.network.saved"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  /**
   * 双线路测试：先按当前设置测一次，再带 `X-RF-Net-Direct: 1` 测一次。
   * **串行**跑（两次真实上游调用，并行只会互相抢带宽、让结论更难读）。
   */
  const probe = async () => {
    setProbing(true);
    setProbeLines(null);
    try {
      const config = await getLLMConfig();
      const current = await testLLM(config);
      const direct = await testLLM(config, "task", true);
      setProbeLines([
        {
          label: t("settingsUi.network.probeCurrent"),
          ok: current.ok,
          message: current.message,
        },
        { label: t("settingsUi.network.probeDirect"), ok: direct.ok, message: direct.message },
      ]);
    } catch (error) {
      setProbeLines([
        {
          label: t("settingsUi.network.probeCurrent"),
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        },
      ]);
    } finally {
      setProbing(false);
    }
  };

  const detected = data?.detected;
  const showDetectedNotice =
    !noticeDismissed && detected !== undefined && !detected.is_direct && mode === "system";

  return (
    <Card
      title={t("settingsUi.network.title")}
      data-testid="network-proxy-card"
      extra={
        <Button size="small" loading={probing} onClick={() => void probe()}>
          {t("settingsUi.network.probe")}
        </Button>
      }
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t("settingsUi.network.intro")}
        </Typography.Paragraph>

        {showDetectedNotice ? (
          <Alert
            type="info"
            showIcon
            closable
            onClose={() => {
              localStorage.setItem(NOTICE_DISMISSED_KEY, "1");
              setNoticeDismissed(true);
            }}
            title={t("settingsUi.network.detected", {
              proxy: detected.host_port,
              source: detected.source_label,
            })}
          />
        ) : null}

        <Radio.Group
          value={mode}
          onChange={(event) => setMode(event.target.value as ProxyMode)}
          options={[
            { value: "system", label: t("settingsUi.network.mode.system") },
            { value: "direct", label: t("settingsUi.network.mode.direct") },
            { value: "custom", label: t("settingsUi.network.mode.custom") },
          ]}
        />

        {mode === "direct" ? (
          <Typography.Text type="danger">{t("settingsUi.network.directWarning")}</Typography.Text>
        ) : null}

        {mode === "custom" ? (
          <Flex vertical gap={8}>
            <Input
              value={proxyUrl}
              onChange={(event) => setProxyUrl(event.target.value)}
              placeholder={t("settingsUi.network.urlPlaceholder")}
              aria-label={t("settingsUi.network.url")}
            />
            <Flex gap={8}>
              <Input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder={t("settingsUi.network.usernamePlaceholder")}
                aria-label={t("settingsUi.network.username")}
              />
              <Input.Password
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={
                  data?.has_password
                    ? t("settingsUi.network.passwordKeep")
                    : t("settingsUi.network.passwordPlaceholder")
                }
                aria-label={t("settingsUi.network.password")}
              />
            </Flex>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("settingsUi.network.socksHint")}
            </Typography.Text>
          </Flex>
        ) : null}

        <Flex align="center" gap={8} wrap>
          <Switch checked={trust} onChange={setTrust} aria-label={t("settingsUi.network.trust")} />
          <div>
            <Typography.Text>{t("settingsUi.network.trust")}</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
              {t("settingsUi.network.trustHint")}
            </Typography.Paragraph>
          </div>
        </Flex>

        {probeLines ? (
          <Flex vertical gap={4} data-testid="network-probe-lines">
            {probeLines.map((line) => (
              <Typography.Text key={line.label} type={line.ok ? "success" : "danger"}>
                {line.label}: {line.ok ? t("settingsUi.network.probeOk") : line.message}
              </Typography.Text>
            ))}
          </Flex>
        ) : null}

        {probeLines?.some((line) => !line.ok) ? (
          // T05：失败时给一份**按原因分组**的清单，每条一句动作。只列"能自己动手"的四类，
          // 不列"请联系服务商"——那等于没说。
          <Flex vertical gap={2} data-testid="network-probe-checklist">
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("settingsUi.network.checklist.title")}
            </Typography.Text>
            {(["proxy", "tls", "refused", "timeout"] as const).map((key) => (
              <Typography.Text key={key} type="secondary" style={{ fontSize: 12 }}>
                · {t(`settingsUi.network.checklist.${key}`)}
              </Typography.Text>
            ))}
          </Flex>
        ) : null}

        {data?.notice && mode !== "direct" ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {data.notice}
          </Typography.Text>
        ) : null}

        <Flex justify="flex-end">
          <Button type="primary" loading={saving} onClick={() => void save()}>
            {t("settingsUi.network.save")}
          </Button>
        </Flex>
      </Space>
    </Card>
  );
}
