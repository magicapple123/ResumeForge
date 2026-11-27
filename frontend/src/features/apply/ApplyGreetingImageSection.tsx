// SPDX-License-Identifier: Apache-2.0
/**
 * 招呼语附带图片（T8）：一个开关 + 一张默认图 + 保存。
 *
 * ## 为什么自己一个页签、自己一个保存按钮
 *
 * 它走 `PUT /apply/greeting-image`，而"投递节奏"走 `PUT /apply/config`。混在一次提交里
 * 「保存设置」会悄悄写两个接口——这与 #14D/#14E 两块的取舍完全一致（话术库、屏蔽清单
 * 也是各自保存）。
 *
 * ## 为什么默认关、且文案反复说"发出去收不回来"
 *
 * 图片是**主动外发内容**：比纯文本更容易被判成营销，而且发出去不可撤回。所以默认值取
 * 最保守的一档，开关旁边必须有一句能读懂后果的说明——只写"附带图片"会让人以为是本地
 * 预览效果。
 *
 * ## 额度数字不在前端写死
 *
 * 单张 / 张数上限都从接口读（权威值在 `services/attachments.py`）。前端另写一份迟早
 * 漂移，而漂移的表现是"界面说可以、后端拒了"。
 */
import { Alert, App, Button, Space, Switch, Typography } from "antd";
import { useState } from "react";
import { getApplyGreetingImage, saveApplyGreetingImage } from "../../api/applyExtras";
import LoadingBlock from "../../components/common/LoadingBlock";
import { useApi } from "../../hooks/useApi";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ApplyGreetingImage } from "../../types";
import { formatBytes } from "../../utils/format";
import GreetingImagePicker from "./GreetingImagePicker";
import "./applySettingsSections.css";

export default function ApplyGreetingImageSection() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块停在旧文案。
  useLocale();
  const { message } = App.useApp();
  const { data, loading, error } = useApi<ApplyGreetingImage>(getApplyGreetingImage, []);
  const [enabled, setEnabled] = useState(false);
  const [imageId, setImageId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  // 渲染期镜像同步（与屏蔽清单同一模式）：接口回包只灌一次，之后由用户编辑。
  const [source, setSource] = useState<ApplyGreetingImage | null>(null);
  if (data && data !== source) {
    setSource(data);
    setEnabled(data.enabled);
    setImageId(data.image_id);
  }

  if (loading && !data) return <LoadingBlock />;

  // 没有可选图片时不能假装"可以选"：给一句"先上传"的指引（上传入口在选择器里）。
  const noOptions = (data?.options ?? []).length === 0;
  const limits = data
    ? t("applySettings.image.limits", {
        single: formatBytes(data.max_image_bytes),
        count: data.max_count,
      })
    : "";

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveApplyGreetingImage({ enabled, image_id: imageId });
      setSource(saved);
      setEnabled(saved.enabled);
      setImageId(saved.image_id);
      message.success(t("applySettings.image.saved"));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("applySettings.image.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        {t("applySettings.image.intro")}
      </Typography.Paragraph>
      {error && <Alert type="error" showIcon title={t("applySettings.image.loadFailed")} />}

      <div>
        <Space size={8} align="center">
          <Switch
            checked={enabled}
            onChange={setEnabled}
            aria-label={t("applySettings.image.enabledLabel")}
          />
          <Typography.Text strong>{t("applySettings.image.enabledLabel")}</Typography.Text>
        </Space>
        <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
          {t("applySettings.image.enabledExtra")}
        </Typography.Paragraph>
      </div>

      <div>
        <Typography.Text strong>{t("applySettings.image.pickLabel")}</Typography.Text>
        <div style={{ margin: "4px 0" }}>
          {/* CR-18：与队列行共用同一个选择器（上传即选中、可删性听后端 deletable）。 */}
          <GreetingImagePicker
            mode="single"
            value={imageId}
            onChange={(next) => setImageId(typeof next === "number" ? next : null)}
            options={data?.options ?? []}
            maxImageBytes={data?.max_image_bytes}
            ariaLabel={t("applySettings.image.pickLabel")}
            placeholder={t("applySettings.image.pickPlaceholder")}
          />
        </div>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          {noOptions ? t("applySettings.image.empty") : t("applySettings.image.pickExtra")}
        </Typography.Paragraph>
        {limits && (
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            {limits}
          </Typography.Paragraph>
        )}
      </div>

      {enabled && imageId === null && (
        // 打开了开关却没选图：不拦保存（用户可能先打开、回头再选），但必须当场说清后果。
        <Alert type="warning" showIcon title={t("applySettings.image.needImage")} />
      )}

      <div>
        <Button type="primary" loading={saving} onClick={() => void save()}>
          {t("applySettings.image.save")}
        </Button>
      </div>
    </Space>
  );
}
