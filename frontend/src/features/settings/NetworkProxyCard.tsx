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
 * - 检测到代理时只挂一条**可操作**的状态条，不弹窗、不阻断：它给的是出路（改为直连），
 *   不是一句"你去改吧"。
 *
 * ## I-33：显式保存 + 脏状态
 *
 * 这一页的保存语义是**显式保存**（不改成自动保存）。但"按钮永远可点、永远主色"读起来像
 * 已经应用了，而 intro 又写着"改完立即生效"——所以补三件事：
 * 1. 表单与服务端配置不一致时才算 `dirty`，按钮才可点，工具栏中间写着「有未保存的更改」；
 * 2. `dirty` 时「测试连接」禁用并写明"先保存再测试"（测试读的是**已保存**配置，这是规则
 *    而不是陷阱）；
 * 3. 任何字段一改就清空上次的测试结论——旧结论对应旧配置，留着就是把"连接成功"挂在新设置上。
 *
 * ## 版面（2026-11 R3-05）
 *
 * 原样是"标题 / 说明 / 蓝条 / 三个裸单选 / 开关 / 孤立的测试按钮 / 甩到右下的保存"，
 * 七块同权重堆叠。现在按"一句说明 → 一条状态 → 三张可点选的卡 → 开关行 → 一条工具栏"
 * 排：单选卡自带一句说明（裸单选不自解释）、保存与测试收进同一条底栏（两者本来就成对）。
 */
import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleOutlined } from "@ant-design/icons";
import { App, Button, Card, Flex, Input, Switch, Typography } from "antd";
import type { InputRef } from "antd";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
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

/** 三档的顺序就是方向键的移动顺序，也是界面上从左到右的顺序。 */
const MODES: readonly ProxyMode[] = ["system", "direct", "custom"];

/** 每张单选卡的说明：裸标题不自解释，用户不知道"跟随"跟的是什么。 */
const MODE_HINT: Record<
  ProxyMode,
  | "settingsUi.network.mode.systemHint"
  | "settingsUi.network.mode.directHint"
  | "settingsUi.network.mode.customHint"
> = {
  system: "settingsUi.network.mode.systemHint",
  direct: "settingsUi.network.mode.directHint",
  custom: "settingsUi.network.mode.customHint",
};

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

  /** 方向键在卡片间移动要能把焦点带过去；`radio` 的键盘惯例是"选中即聚焦"。 */
  const modeRefs = useRef<Partial<Record<ProxyMode, HTMLButtonElement | null>>>({});
  /** 选「自定义代理」时把焦点送进地址框——但只在**用户主动选**时，方向键路过不算。 */
  const urlRef = useRef<InputRef>(null);
  const wantUrlFocus = useRef(false);

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
   * 地址框只在 `mode === "custom"` 时存在，所以焦点必须等这一帧渲染完再送。
   * 用 `ref` 传意图而不是把 `mode` 塞进依赖里反复抢焦点。
   */
  useEffect(() => {
    if (mode !== "custom" || !wantUrlFocus.current) return;
    wantUrlFocus.current = false;
    urlRef.current?.focus();
  }, [mode]);

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

  /**
   * 切换出网方式。`focus` 区分三种来源：
   * - `"url"`：用户点了「自定义代理」卡 → 焦点送进地址框；
   * - `"card"`：方向键在组内移动 → 焦点跟着选中项走，不抢到地址框；
   * - `null`：程序化切换（状态条的「改为直连」）→ 焦点留在原处，不打断读屏。
   *
   * 地址/用户名/口令存在组件状态里，切走再切回来内容还在（不重置字段是本卡的约定）。
   */
  const selectMode = (next: ProxyMode, focus: "url" | "card" | null = null) => {
    changed();
    if (focus === "url") wantUrlFocus.current = true;
    setMode(next);
    if (focus === "card") modeRefs.current[next]?.focus();
  };

  /** radiogroup 的方向键：←/↑ 上一张、→/↓ 下一张，循环。 */
  const onModeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forward && !backward) return;
    event.preventDefault();
    const step = forward ? 1 : -1;
    const index = MODES.indexOf(mode);
    const next = MODES[(index + step + MODES.length) % MODES.length];
    selectMode(next, "card");
  };

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
  const showDetectedNotice = detected !== undefined && !detected.is_direct && mode === "system";

  return (
    <Card
      className="settings-card"
      title={
        // 约束（"保存后即时生效"）挨着标题说，比埋在正文里更容易被读到。
        <div className="network-head">
          <span className="network-head-title">{t("settingsUi.network.title")}</span>
          <span className="network-head-hint">{t("settingsUi.network.instantHint")}</span>
        </div>
      }
      data-testid="network-proxy-card"
    >
      <div className="network-card">
        <p className="network-lede">{t("settingsUi.network.intro")}</p>

        {/* 检测提示与底部灰字是同一件事的两种写法：**互斥**，不同时渲染。
            状态条给的是出路（右侧按钮直接切成直连），所以不需要关闭按钮。 */}
        {showDetectedNotice ? (
          <div className="network-status" data-testid="network-detected">
            <span className="network-status-dot" aria-hidden="true" />
            <span className="network-status-text">
              {t("settingsUi.network.detected", {
                proxy: detected.host_port,
                source: detected.source_label,
              })}
            </span>
            <Button
              type="link"
              size="small"
              className="network-status-action"
              onClick={() => selectMode("direct")}
            >
              {t("settingsUi.network.useDirect")}
            </Button>
          </div>
        ) : data?.notice && mode !== "direct" ? (
          <Typography.Text type="secondary" className="network-notice">
            {data.notice}
          </Typography.Text>
        ) : null}

        {/* 三张卡而不是三个裸单选：每张自带一句说明，一次说清"有哪些、现在选哪个、
            它做什么"。容器自己处理方向键，符合 radiogroup 惯例。 */}
        <div
          className="network-modes"
          role="radiogroup"
          aria-label={t("settingsUi.network.modeLabel")}
          onKeyDown={onModeKeyDown}
        >
          {MODES.map((value) => {
            const active = value === mode;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                ref={(node) => {
                  modeRefs.current[value] = node;
                }}
                className={`network-mode${active ? " is-active" : ""}`}
                data-testid={`network-mode-${value}`}
                onClick={() => selectMode(value, value === "custom" ? "url" : null)}
              >
                <span className="network-mode-title">{t(`settingsUi.network.mode.${value}`)}</span>
                <span className="network-mode-desc">{t(MODE_HINT[value])}</span>
              </button>
            );
          })}
        </div>

        {mode === "direct" ? (
          <Typography.Text type="danger">{t("settingsUi.network.directWarning")}</Typography.Text>
        ) : null}

        {mode === "custom" ? (
          <Flex vertical gap={8} className="network-custom">
            <Input
              ref={urlRef}
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
            <Typography.Text type="secondary" className="network-hint">
              {t("settingsUi.network.socksHint")}
            </Typography.Text>
          </Flex>
        ) : null}

        {/* 开关在**行尾**、标签在左：读到标签时控件就在同一行右侧，不用来回扫。
            整行可点（控件本身除外，避免一次点击翻两次）。 */}
        <div
          className="network-row"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest(".ant-switch")) return;
            changed();
            setTrust(!trust);
          }}
        >
          <div className="network-row-text">
            <span className="network-row-label">{t("settingsUi.network.trust")}</span>
            <p className="network-row-hint">{t("settingsUi.network.trustHint")}</p>
          </div>
          <Switch
            className="network-row-switch"
            checked={trust}
            onChange={(next) => {
              changed();
              setTrust(next);
            }}
            aria-label={t("settingsUi.network.trust")}
          />
        </div>

        {/* 结果区常驻固定高度：出现/消失时底部工具栏不位移。 */}
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
              <Typography.Text type="secondary" className="network-hint">
                {t("settingsUi.network.checklist.title")}
              </Typography.Text>
              {(["proxy", "tls", "refused", "timeout"] as const).map((key) => (
                <Typography.Text key={key} type="secondary" className="network-hint">
                  · {t(`settingsUi.network.checklist.${key}`)}
                </Typography.Text>
              ))}
            </Flex>
          ) : null}
        </div>

        {/* 一条工具栏：测试在左、状态在中、保存在右。三者本来就成对使用，
            拆开摆会让"保存"孤立在右下角。 */}
        <div className="network-toolbar">
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
          <span className="network-toolbar-reason">
            {dirty ? t("settingsUi.network.probeBlocked") : null}
          </span>
          <span className={`network-toolbar-state${dirty ? " is-dirty" : ""}`} aria-live="polite">
            {dirty ? (
              <>
                <ExclamationCircleOutlined className="network-toolbar-dot" aria-hidden="true" />
                {t("settingsUi.network.dirty")}
              </>
            ) : (
              t("settingsUi.network.clean")
            )}
          </span>
          <Button type="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
            {t("settingsUi.network.save")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
