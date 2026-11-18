// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「出网与代理」卡（T02 / T05 / I-33）。
 *
 * 为什么需要这张卡：改造前"用不用代理"只能改系统环境变量并重启。这台机器装了 Clash 而
 * 模型连不上时，用户手里**没有任何可以按的按钮**，错误文案也只会说「无法连接模型服务」。
 *
 * 三条边界（都是可观察的）：
 * - 三档里「直连」是唯一会让用户"自己把自己断网"的开关，所以它带一条一直可见的警示，
 *   并且**默认不选**（默认跟随系统）；
 * - 「信任系统证书库」默认关：打开等于承认这台机器上任何被系统信任的中间人证书都可信；
 * - 检测到代理时只挂一条**可关闭**的提示，不弹窗、不阻断。
 *
 * ## I-33：显式保存 + 脏状态
 *
 * 这一页的保存语义是**显式保存**（不改成自动保存）。但"按钮永远可点、永远主色"读起来像
 * 已经应用了，而 intro 又写着"改完立即生效"——所以补三件事：
 * 1. 表单与服务端配置不一致时才算 `dirty`，按钮才可点，左侧出现「有未保存的更改」；
 * 2. `dirty` 时「测试连接」禁用并写明"先保存再测试"（测试读的是**已保存**配置，这是规则
 *    而不是陷阱）；
 * 3. 任何字段一改就清空上次的测试结论——旧结论对应旧配置，留着就是把"连接成功"挂在新设置上。
 */
import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleOutlined } from "@ant-design/icons";
import {
  App,
  Alert,
  Button,
  Card,
  Divider,
  Flex,
  Input,
  Radio,
  Space,
  Switch,
  Typography,
} from "antd";
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
import "./network-proxy-card.css";

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

  /**
   * 表单相对**已保存配置**是否有改动。`password` 非空即脏（不回显，所以有值必然是刚输入的），
   * 但 `apply()` 之后会被清空——否则保存成功仍显示"有未保存的更改"。
   */
  const dirty =
    data !== null &&
    (mode !== data.proxy_mode ||
      proxyUrl !== data.proxy_url ||
      username !== data.proxy_username ||
      trust !== data.trust_system_certs ||
      password !== "");

  /** 任一字段变更：旧测试结论立刻作废（它测的是上一份配置）。 */
  const changed = () => setProbeLines(null);

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
      setProbeLines(null);
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
   * 测的永远是**已保存**配置：有未保存改动时按钮是禁用的（见下）。
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
      className="settings-card"
      title={t("settingsUi.network.title")}
      data-testid="network-proxy-card"
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t("settingsUi.network.intro")}
        </Typography.Paragraph>

        {/* 检测提示与底部灰字是同一件事的两种写法：**互斥**，不同时渲染。 */}
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
        ) : data?.notice && mode !== "direct" ? (
          <Typography.Text type="secondary" className="network-notice">
            {data.notice}
          </Typography.Text>
        ) : null}

        <Radio.Group
          value={mode}
          onChange={(event) => {
            changed();
            setMode(event.target.value as ProxyMode);
          }}
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
              onChange={(event) => {
                changed();
                setProxyUrl(event.target.value);
              }}
              placeholder={t("settingsUi.network.urlPlaceholder")}
              aria-label={t("settingsUi.network.url")}
            />
            <Flex gap={8}>
              <Input
                value={username}
                onChange={(event) => {
                  changed();
                  setUsername(event.target.value);
                }}
                placeholder={t("settingsUi.network.usernamePlaceholder")}
                aria-label={t("settingsUi.network.username")}
              />
              <Input.Password
                value={password}
                onChange={(event) => {
                  changed();
                  setPassword(event.target.value);
                }}
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
          <Switch
            checked={trust}
            onChange={(next) => {
              changed();
              setTrust(next);
            }}
            aria-label={t("settingsUi.network.trust")}
          />
          <div>
            <Typography.Text>{t("settingsUi.network.trust")}</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
              {t("settingsUi.network.trustHint")}
            </Typography.Paragraph>
          </div>
        </Flex>

        {/* 分区用一条细分隔线，不新造分组样式、也不新增小节文案。 */}
        <Divider className="network-divider" />

        <Flex align="center" gap={8} wrap>
          {/* 禁用态按钮上的 Tooltip 在 antd 里根本不触发（无 hover 目标），
              所以原因只写在按钮右边一次，不重复挂两处。 */}
          <Button
            size="small"
            loading={probing}
            disabled={!data || dirty}
            onClick={() => void probe()}
          >
            {t("settingsUi.network.probe")}
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {dirty ? t("settingsUi.network.probeBlocked") : ""}
          </Typography.Text>
        </Flex>

        {/* 结果区常驻固定高度：出现/消失时 footer 与保存按钮不位移。 */}
        <div className="network-probe-area" data-testid="network-probe-area">
          {probeLines ? (
            <Flex vertical gap={4} data-testid="network-probe-lines">
              {probeLines.map((line) => (
                <Flex key={line.label} align="baseline" gap={6}>
                  {line.ok ? (
                    <CheckCircleFilled className="network-probe-icon is-ok" />
                  ) : (
                    <CloseCircleFilled className="network-probe-icon is-bad" />
                  )}
                  <Typography.Text type={line.ok ? "success" : "danger"}>
                    {line.label}: {line.ok ? t("settingsUi.network.probeOk") : line.message}
                  </Typography.Text>
                </Flex>
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
        </div>

        <Flex className="network-footer" justify="space-between" align="center">
          {/* 无改动时留空但不塌陷：footer 高度固定，按钮不跳。 */}
          <span className={`network-dirty${dirty ? " is-visible" : ""}`} aria-live="polite">
            {dirty ? (
              <>
                <ExclamationCircleOutlined className="network-dirty-dot" aria-hidden="true" />
                {t("settingsUi.network.dirty")}
              </>
            ) : null}
          </span>
          <Button type="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
            {t("settingsUi.network.save")}
          </Button>
        </Flex>
      </Space>
    </Card>
  );
}
