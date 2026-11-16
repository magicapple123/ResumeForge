// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「求职助手 · 数据权限」卡（T11）。
 *
 * 四档同时决定读、写两轴：仅查看 / 放宽读取 / 可修改 / 完全权限。这里保存的是**全局默认**；
 * 输入框旁的下拉按会话覆盖（本机 localStorage）。扩权前把解锁范围与始终不解锁的边界
 * 说清楚——提前告知是这个功能成立的前提：API 密钥等凭据任何档位都不发给模型，简历照片
 * 二进制不发送，助手也没有删除类工具。
 */
import { App, Card, Flex, Radio, Space, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import LoadingBlock from "../../components/common/LoadingBlock";
import { getAssistantPermission, saveAssistantPermission } from "../../api/assistantPermission";
import type { AssistantPermissionLevel } from "../../api/assistantPermission";
import {
  ASSISTANT_PERMISSION_DESC_KEYS,
  ASSISTANT_PERMISSION_LABEL_KEYS,
  ASSISTANT_PERMISSION_LEVELS,
  bumpAssistantPermission,
  isWriteLevel,
} from "../assistant/assistantPermission";
import SettingsResetButton from "./SettingsResetButton";
import { useSettingsResetListener } from "./useSettingsResetListener";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/**
 * I-10：这张卡能恢复默认的键。
 *
 * 权限档位是「读轴 + 写轴」同一条记录，旧键 `assistant_relaxed_mode` 与新四档同步写入，
 * 两者必须一起回默认，否则界面显示「仅查看」而后端仍是放宽读取。同 scope 的其它键
 * （工具轮数、记忆开关…）属于别的卡，不在这里重置。
 */
const PERMISSION_RESET_KEYS = ["assistant_permission", "assistant_relaxed_mode"];

export default function AssistantRelaxedModeCard() {
  // 本组件用模块级 t()：必须订阅语言变化。
  useLocale();
  const { message } = App.useApp();
  const [permission, setPermission] = useState<AssistantPermissionLevel>("read_only");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 纯取数（不含 loading 的收尾）：挂载与「恢复默认」后走同一份实现，避免两处漂移。
  const load = useCallback(async () => {
    try {
      const saved = await getAssistantPermission();
      setPermission(saved.permission);
    } catch {
      // 读不到按默认「仅查看」处理：这是扩权设置，保守显示比假装开着安全。
      setPermission("read_only");
    }
  }, []);

  // Compiler 规范：挂载加载用内联 async IIFE（setState 在自身回调里应用）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  // I-10：恢复默认成功后重取本卡的值，并让输入区那个「跟随全局」下来也立刻跟上。
  useSettingsResetListener(() => {
    bumpAssistantPermission();
    void load();
  });

  const onChange = async (next: AssistantPermissionLevel) => {
    if (saving || next === permission) return;
    const previous = permission;
    setSaving(true);
    setPermission(next);
    try {
      const saved = await saveAssistantPermission({ permission: next });
      setPermission(saved.permission);
      // 输入区那块下拉的「跟随全局」立刻跟着变：清掉进程内缓存并通知订阅方重取。
      bumpAssistantPermission();
      message.success(
        t("assistantPermission.settings.saveToast", {
          level: t(ASSISTANT_PERMISSION_LABEL_KEYS[saved.permission]),
        }),
      );
    } catch (err) {
      setPermission(previous);
      message.error(
        err instanceof Error ? err.message : t("assistantPermission.settings.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title={
        <Flex align="center" gap={8}>
          <span>{t("assistantPermission.settings.title")}</span>
          {/* I-10：卡片级恢复默认（回到最低档「仅查看」）。 */}
          <SettingsResetButton keys={PERMISSION_RESET_KEYS} />
        </Flex>
      }
      className="settings-card"
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("assistantPermission.settings.intro")}
      </Typography.Paragraph>
      <LoadingBlock spinning={loading}>
        {/* `assistant-permission-stack` 是权限卡的定位锚点：卡片内容区的宽度容器
            （`container-type: inline-size` 挂在它上面，见 `styles/assistant-composer.css`）。
            外层的纵向 Space 是 `inline-flex`（按内容收缩），没有这个类名，网格会只有
            内容宽度，右侧又空回去。 */}
        <Space orientation="vertical" size={12} className="assistant-permission-stack">
          <Radio.Group
            aria-label={t("assistantPermission.settings.aria")}
            className="assistant-permission-grid"
            value={permission}
            disabled={saving}
            onChange={(event) => void onChange(event.target.value as AssistantPermissionLevel)}
          >
            {/* 四档排 2×2（11-1）：原来是一个纵向 `Space`，四条竖直堆叠只用掉卡片左侧
                ~280px。网格直接挂在这个 `Radio.Group` 上——四个 `Radio` 就是网格项，
                不再套一层 `Space`，也就没有"把 antd 的 `.ant-space` 摊平成
                `display: contents`"这种会外溢到别的卡的写法。 */}
            {ASSISTANT_PERMISSION_LEVELS.map((level) => (
              <Radio key={level} value={level}>
                <span className="assistant-permission-option">
                  <span className="assistant-permission-option-name">
                    {t(ASSISTANT_PERMISSION_LABEL_KEYS[level])}
                  </span>
                  <span className="assistant-permission-option-desc">
                    {t(ASSISTANT_PERMISSION_DESC_KEYS[level])}
                  </span>
                </span>
              </Radio>
            ))}
          </Radio.Group>
          <Typography.Text type="secondary">
            {t("assistantPermission.settings.state", {
              level: t(ASSISTANT_PERMISSION_LABEL_KEYS[permission]),
            })}
          </Typography.Text>
          {isWriteLevel(permission) ? (
            <Typography.Text type="warning">
              {t("assistantPermission.settings.writeHint")}
            </Typography.Text>
          ) : null}
          <Typography.Text type="secondary">
            {t("assistantPermission.settings.neverSent")}
          </Typography.Text>
        </Space>
      </LoadingBlock>
    </Card>
  );
}
