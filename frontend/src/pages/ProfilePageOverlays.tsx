// SPDX-License-Identifier: Apache-2.0
/**
 * 我的资料页的浮层区：编辑操作条、未保存确认卡片、粘贴识别弹窗、组/字段管理弹层与
 * 放置指引。
 *
 * 从 ProfilePage 拆出（行数预算）：这些组件全部由页面持有开关与回调，本文件只做装配，
 * **不存 state**。样式与交互契约留在各自的组件里。
 */
import type { ComponentProps } from "react";
import ProfileEditActionBar from "../features/profile/fields/ProfileEditActionBar";
import ProfileLeaveConfirmModal from "../features/profile/fields/ProfileLeaveConfirmModal";
import ProfilePageModals from "../features/profile/fields/ProfilePageModals";
import ProfileGroupManagerModal from "../features/profile/groups/ProfileGroupManagerModal";
import ProfilePlacementGuide from "../features/profile/library/ProfilePlacementGuide";

export interface ProfilePageOverlaysProps {
  editing: boolean;
  dirty: boolean;
  saving: boolean;
  blocked: boolean;
  onSave: () => void;
  onCancel: () => void;
  leaveConfirm: ComponentProps<typeof ProfileLeaveConfirmModal>;
  profileTextModal: ComponentProps<typeof ProfilePageModals>["profileText"];
  webformTextModal?: ComponentProps<typeof ProfilePageModals>["webformText"];
  /** 组/字段管理弹层；null = 不渲染（与页面 managerOpen 同义）。 */
  manager: ComponentProps<typeof ProfileGroupManagerModal> | null;
  placementGuide: ComponentProps<typeof ProfilePlacementGuide>;
}

export default function ProfilePageOverlays({
  editing,
  dirty,
  saving,
  blocked,
  onSave,
  onCancel,
  leaveConfirm,
  profileTextModal,
  webformTextModal,
  manager,
  placementGuide,
}: ProfilePageOverlaysProps) {
  return (
    <>
      {/* 编辑且有未保存改动时，操作条常驻内容区底部（需求 6）：页头的保存/取消只在页顶，
          资料页又长，改到下面几条就够不着了。动作**复用** submitAll / handleCancelEditing，
          所以校验、冲突提示、离开守卫都还是同一条路径。
          未保存确认卡片弹出时收起：同一屏不要再摆第二组"保存/取消"——这与页面里
          `leaveGuard.confirmOpen` 让位是同一条理由。 */}
      {leaveConfirm.open ? null : (
        <ProfileEditActionBar
          editing={editing}
          dirty={dirty}
          saving={saving}
          blocked={blocked}
          onSave={onSave}
          onCancel={onCancel}
        />
      )}

      {/* 未保存修改的确认卡片：与三个 Modal 并列挂在页面上，打开时遮罩 + 居中，
          不再挤在页面最顶部（触发它的按钮可能在页头甚至页外，用户根本看不到）。 */}
      <ProfileLeaveConfirmModal {...leaveConfirm} />

      <ProfilePageModals profileText={profileTextModal} webformText={webformTextModal} />

      {manager ? <ProfileGroupManagerModal {...manager} /> : null}

      <ProfilePlacementGuide {...placementGuide} />
    </>
  );
}
