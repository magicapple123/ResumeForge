// SPDX-License-Identifier: Apache-2.0
/** 个人资料各大分区的排序布局。 */

import { Card, Form, Input } from "antd";
import { useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { AwardSection } from "./AwardSection";
import { CampusExperienceSection } from "./CampusExperienceSection";
import { EducationSection } from "./EducationSection";
import { ExperienceSection } from "./ExperienceSection";
import { SortableProfileSection } from "./ProfileSectionShell";
import type { ProfileSectionPointerDownHandler } from "./ProfileSectionShell";
import { DEFAULT_SECTION_ORDER } from "./ProfileSectionConfig";
import type { ProfileSectionKey } from "./ProfileSectionConfig";
import ProfileBasicSection from "./ProfileBasicSection";
import { ProjectSection } from "./ProjectSection";
import { SkillSection } from "./SkillSection";
import type { ProfileSectionOrderStore } from "../../features/profile/sectionOrderStore";

interface Props {
  /**
   * 顺序与排序模式的外部 store（见 `useProfileSectionReorder` 的说明）。
   *
   * 顺序**不走 props**：拖拽实时重排每次 splice 都换数组，若经 props 传入，页面级
   * `resumeContent`/`workspaceTabs` 的 useMemo 会被打穿，antd `Form` 换 context 让
   * 全部 Form.Item 陪跑（拖拽卡顿的根因）。订阅 store 后每次 splice 只重渲本组件。
   */
  reorderStore: ProfileSectionOrderStore;
  editing: boolean;
  saving: boolean;
  photo: string;
  /** 查看态下被折叠的分区；编辑态忽略（永远展开）。 */
  collapsedSections: Set<ProfileSectionKey>;
  onToggleCollapsed: (sectionKey: ProfileSectionKey) => void;
  onPhotoSelect: (dataUrl: string) => void;
  onHandlePointerDown: ProfileSectionPointerDownHandler;
  onMoveByOffset: (sectionKey: ProfileSectionKey, offset: -1 | 1) => void;
}

export default function ProfileSectionStack({
  reorderStore,
  editing,
  saving,
  photo,
  collapsedSections,
  onToggleCollapsed,
  onPhotoSelect,
  onHandlePointerDown,
  onMoveByOffset,
}: Props) {
  const { sectionOrder, reordering, draggingKey, compact } = useSyncExternalStore(
    reorderStore.subscribe,
    reorderStore.getSnapshot,
  );

  // 分区内容整体 memo：内容引用稳定后，memo 化的 SortableProfileSection 才能在
  // 排序重排 / 无关渲染时真正跳过未变化的分区子树（T05 防全页重渲的另一半）。
  const sectionContent: Record<ProfileSectionKey, ReactNode> = useMemo(
    () => ({
      basic_info: (
        <ProfileBasicSection
          photo={photo}
          editing={editing}
          saving={saving}
          onPhotoSelect={onPhotoSelect}
        />
      ),
      educations: <EducationSection editable={editing} />,
      experiences: <ExperienceSection editable={editing} />,
      campus_experiences: <CampusExperienceSection editable={editing} />,
      projects: <ProjectSection editable={editing} />,
      skills: <SkillSection editable={editing} />,
      awards: <AwardSection editable={editing} />,
      summary: (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Form.Item name="summary" style={{ marginBottom: 0 }}>
            <Input.TextArea
              rows={4}
              placeholder="几句话概括你的优势与特点，AI 会结合目标岗位进行润色"
            />
          </Form.Item>
        </Card>
      ),
    }),
    [editing, onPhotoSelect, photo, saving],
  );

  const section = (sectionKey: ProfileSectionKey, children: ReactNode) => {
    const order = sectionOrder.indexOf(sectionKey);
    return (
      <SortableProfileSection
        key={sectionKey}
        sectionKey={sectionKey}
        order={order}
        editable={editing}
        reordering={reordering}
        dragging={draggingKey === sectionKey}
        // 拖动激活期全部折叠成紧凑条：一个开关驱动所有分区（含未被拖的），这正是
        // 「一开始拖就全部收起来」的实现点（见 profileCompactDrag.ts）。
        compact={compact}
        collapsed={!editing && collapsedSections.has(sectionKey)}
        // 微调按钮边界：`basic_info` 固定首位（order 0），第 1 个可拖分区（order 1）
        // 的上移禁用；末位（order = 总数 − 1）的下移禁用。与键盘排序的钳制一致。
        canMoveUp={order > 1}
        canMoveDown={order >= 0 && order < sectionOrder.length - 1}
        onToggleCollapsed={onToggleCollapsed}
        onHandlePointerDown={onHandlePointerDown}
        onMoveByOffset={onMoveByOffset}
      >
        {children}
      </SortableProfileSection>
    );
  };

  return (
    <div className={`profile-section-stack${reordering ? " is-section-reordering" : ""}`}>
      {/*
       * DOM 顺序固定为默认序，视觉顺序完全交给每个分区的 CSS `order` 样式。
       * 之前按 sectionOrder 渲染，实时重排的每次 splice 都让 React 按 key 移动
       * 大表单的 DOM 子树（含 antd Form 大片结构），移动即触发整栈 relayout；
       * 现在重排只更新两三个分区的 order 内联样式，DOM 节点全程不动、不重挂。
       */}
      {DEFAULT_SECTION_ORDER.map((sectionKey) => section(sectionKey, sectionContent[sectionKey]))}
    </div>
  );
}
