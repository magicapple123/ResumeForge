// SPDX-License-Identifier: Apache-2.0
/**
 * 「我的资料」编辑操作条（需求 6）：编辑且有改动时，一直贴在内容区底部。
 *
 * 为什么要有它：页头的「保存全部资料 / 取消」只在页顶，资料页又很长——改到教育经历第
 * 三条时想保存，得先滚回页顶。用户的原话是"要在随时看得见的地方给取消 / 保存"。
 *
 * 三条边界：
 * 1. **只在 `editing && dirty` 出现**。进编辑但没改过时没有东西要存，这条常驻横条就只是
 *    白占屏幕；退出编辑或保存成功后它自己消失，不需要调用方再管一次。
 * 2. **动作只有一处实现**：两个按钮直接调页面传进来的 `onSave` / `onCancel`，也就是页头
 *    那两个按钮背后的 `submitAll` / `handleCancelEditing`（含校验、冲突提示、离开守卫）。
 *    这里不复制保存逻辑，否则两条路径迟早各错一半。
 * 3. **不和投投悬浮球抢位置**：条本身是 `position: fixed`（见 styles/profile-edit-bar.css），
 *    右侧留出一条给球的静止车道；球是 3650 层级、压在本条之上，不留车道就会正好盖住
 *    「保存修改」。同时条的下方渲染等高的占位块，滚到最底时表单最后一行不会被压在条下。
 */
import { CloseOutlined, SaveOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export interface ProfileEditActionBarProps {
  /** 是否处于编辑态。与 `dirty` 同时成立才渲染。 */
  editing: boolean;
  /** 是否有未保存的改动。 */
  dirty: boolean;
  /** 保存请求进行中：主按钮进加载态，取消先禁用（避免请求途中把表单关掉）。 */
  saving: boolean;
  /**
   * 暂时不允许保存（例如照片还在读取、文本识别正在填入）。
   *
   * 与页头同一判据：页头的保存按钮也是 `disabled={photoReading}`，两处不一致会让用户
   * 看到"顶部能点、底部不能点"。
   */
  blocked?: boolean;
  /** 复用页面的 `submitAll`（校验 + 冲突提示 + 网申资料一并提交）。 */
  onSave: () => void;
  /** 复用页面的 `handleCancelEditing`（dirty 时先过离开守卫的居中确认卡片）。 */
  onCancel: () => void;
}

export default function ProfileEditActionBar({
  editing,
  dirty,
  saving,
  blocked = false,
  onSave,
  onCancel,
}: ProfileEditActionBarProps) {
  useLocale();
  // 没有改动就没有要保存的东西；不在编辑态更不该出现第二条操作栏。
  if (!editing || !dirty) return null;
  return (
    <div
      className="profile-edit-bar-region"
      data-testid="profile-edit-bar"
      role="group"
      aria-label={t("profileLibrary.editBar.ariaLabel")}
    >
      {/* 等高空占位：条是 fixed，滚到最底时最后一行表单要靠它让出位置。 */}
      <div className="profile-edit-bar-spacer" aria-hidden="true" />
      <div className="profile-edit-bar">
        <span className="profile-edit-bar-hint">{t("profileLibrary.editBar.title")}</span>
        <span className="profile-edit-bar-actions">
          <Button icon={<CloseOutlined />} disabled={saving || blocked} onClick={onCancel}>
            {t("profileLibrary.editBar.cancel")}
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            disabled={blocked}
            onClick={onSave}
          >
            {t("profileLibrary.editBar.save")}
          </Button>
        </span>
      </div>
    </div>
  );
}
