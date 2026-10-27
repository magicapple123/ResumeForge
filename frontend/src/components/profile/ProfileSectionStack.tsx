// SPDX-License-Identifier: Apache-2.0
/**
 * 资料页分区布局（F6）：按「服务端定义 + 当前组参与清单 + 全局顺序」渲染。
 *
 * 顺序不通过 props 传入：它住在 sectionOrderStore（useSyncExternalStore），拖拽实时重排
 * 只重渲本组件，不换 antd Form 的 context（否则 13 分区全部 Form.Item 陪跑）。
 * 参与清单来自 workspace.current_group.participating_keys；basic_info 恒在首位。
 * 内容整体 useMemo：内容引用稳定，memo 化的分区壳才能在无关渲染时真正跳过。
 */
import { useMemo, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { SettingOutlined } from "@ant-design/icons";
import { Button, ConfigProvider, Popover, Tooltip, Typography } from "antd";
import EmptyState from "../common/EmptyState";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ProfileSectionOrderStore } from "../../features/profile/sectionOrderStore";
import type { FieldOut, LimitsOut, SectionOut } from "../../features/profile-library/types";
import ProfileEntrySection from "../../features/profile-library/ProfileEntrySection";
import ProfileBasicSection from "./ProfileBasicSection";
import { SortableProfileSection } from "./ProfileSectionShell";
import type { ProfileSectionPointerDownHandler } from "./ProfileSectionShell";

interface Props {
  /** 全部活动定义（13 内置 + 自建；按服务端 sections 原序）。 */
  sections: SectionOut[];
  /** 当前组参与清单（basic_info 恒首位）。 */
  participatingKeys: string[];
  reorderStore: ProfileSectionOrderStore;
  editing: boolean;
  saving: boolean;
  photo: string;
  limits: LimitsOut;
  collapsedSections: Set<string>;
  onToggleCollapsed: (sectionKey: string) => void;
  onPhotoSelect: (dataUrl: string) => void;
  onHandlePointerDown: ProfileSectionPointerDownHandler;
  onMoveByOffset: (sectionKey: string, offset: -1 | 1) => void;
  onAddEntry: (sectionKey: string) => void;
  onRemoveEntry: (sectionKey: string, entryKey: string, title: string) => void;
  onSetPreference: (field: FieldOut, patch: { hidden?: boolean }) => void;
  onOpenFieldSettings: (sectionKey: string) => void;
  onOpenGuide: () => void;
  onRequestEdit: () => void;
  onOpenGroupManager: () => void;
  /** F9「显示」：把大字段加回当前组参与清单（不进入编辑态）。 */
  onSetSectionVisible: (sectionKey: string, visible: boolean) => void;
  /** 参与清单写请求进行中：禁用「显示」按钮，避免连续点击互相覆盖。 */
  sectionVisibilityBusy?: boolean;
}

export default function ProfileSectionStack(props: Props) {
  useLocale();
  const {
    sections,
    participatingKeys,
    reorderStore,
    editing,
    saving,
    photo,
    limits,
    collapsedSections,
    onToggleCollapsed,
    onPhotoSelect,
    onHandlePointerDown,
    onMoveByOffset,
    onAddEntry,
    onRemoveEntry,
    onSetPreference,
    onOpenFieldSettings,
    onOpenGuide,
    onRequestEdit,
    onOpenGroupManager,
    onSetSectionVisible,
    sectionVisibilityBusy = false,
  } = props;
  const { sectionOrder, reordering, draggingKey, compact } = useSyncExternalStore(
    reorderStore.subscribe,
    reorderStore.getSnapshot,
  );

  const sectionByKey = useMemo(
    () => new Map(sections.map((section) => [section.key, section])),
    [sections],
  );
  const visibleSections = useMemo(() => {
    const keys = participatingKeys.filter((key) => sectionByKey.has(key));
    const ordered = sectionOrder.filter((key) => keys.includes(key));
    const rest = keys.filter((key) => !ordered.includes(key));
    return [...ordered, ...rest]
      .map((key) => sectionByKey.get(key))
      .filter((section): section is SectionOut => Boolean(section));
  }, [participatingKeys, sectionByKey, sectionOrder]);

  const sectionContent = useMemo(() => {
    const content = new Map<string, ReactNode>();
    visibleSections.forEach((section) => {
      if (section.key === "basic_info") {
        content.set(
          section.key,
          <ProfileBasicSection
            section={section}
            photo={photo}
            editing={editing}
            saving={saving}
            limits={limits}
            onPhotoSelect={onPhotoSelect}
            onSetPreference={onSetPreference}
          />,
        );
        return;
      }
      content.set(
        section.key,
        <ProfileEntrySection
          section={section}
          editing={editing}
          saving={saving}
          entryLimit={limits.max_entries_per_section}
          singleLineMax={limits.single_line_chars}
          multiLineMax={limits.multi_line_chars}
          onRequestEdit={onRequestEdit}
          onAddEntry={onAddEntry}
          onRemoveEntry={onRemoveEntry}
          onSetPreference={onSetPreference}
          onOpenGuide={onOpenGuide}
        />,
      );
    });
    return content;
  }, [
    editing,
    limits,
    onAddEntry,
    onOpenGuide,
    onPhotoSelect,
    onRemoveEntry,
    onRequestEdit,
    onSetPreference,
    photo,
    saving,
    visibleSections,
  ]);

  /**
   * 每个分区的「字段设置」齿轮（常驻在标题栏右侧）。
   *
   * 此前它渲染在内容区的同名标题行里，与外部标题栏重复；挪到标题栏后由本组件按
   * section.key 直接生成。basic_info 没有字段设置入口（照片不是可配置字段）。
   * 查看态整页在 <Form disabled> 里，DisabledContext 会连坐按钮：就地放开。
   */
  const sectionActions = useMemo(() => {
    const actions = new Map<string, ReactNode>();
    visibleSections.forEach((section) => {
      if (section.key === "basic_info") return;
      actions.set(
        section.key,
        <ConfigProvider componentDisabled={false}>
          <Tooltip title={t("profileLibrary.section.fieldSettings")}>
            <Button
              size="small"
              type="text"
              icon={<SettingOutlined />}
              aria-label={t("profileLibrary.section.fieldSettingsAria", { name: section.name })}
              onClick={() => onOpenFieldSettings(section.key)}
            />
          </Tooltip>
        </ConfigProvider>,
      );
    });
    return actions;
  }, [onOpenFieldSettings, visibleSections]);

  const onlyBasicInfo = visibleSections.length <= 1 && participatingKeys.length <= 1;

  // F9：隐藏 = 不在当前组参与清单里（basic_info 恒参与，不算隐藏）。
  const participatingSet = useMemo(() => new Set(participatingKeys), [participatingKeys]);
  const hiddenSections = useMemo(
    () =>
      sections.filter(
        (section) => section.key !== "basic_info" && !participatingSet.has(section.key),
      ),
    [participatingSet, sections],
  );
  const [hiddenListOpen, setHiddenListOpen] = useState(false);

  const hiddenList = (
    <div className="profile-hidden-sections-list">
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        {t("profileLibrary.hiddenSections.hint")}
      </Typography.Paragraph>
      {hiddenSections.map((section) => (
        <div key={section.key} className="profile-hidden-section-row">
          <Typography.Text>{section.name}</Typography.Text>
          <Button
            size="small"
            aria-label={t("profileLibrary.hiddenSections.showAria", { name: section.name })}
            disabled={sectionVisibilityBusy || undefined}
            onClick={() => onSetSectionVisible(section.key, true)}
          >
            {t("profileLibrary.hiddenSections.show")}
          </Button>
        </div>
      ))}
    </div>
  );

  return (
    <div className={"profile-section-stack" + (reordering ? " is-section-reordering" : "")}>
      {/* 这两个入口在查看态也要能点：它们只是写参与清单，不进入编辑态。
          资料页的输入控件整体包在 <Form disabled> 里（disabled 会经 DisabledContext
          传导给 Button），所以这里就地覆盖成可交互，不改 Form 的语义。 */}
      <ConfigProvider componentDisabled={false}>
        {hiddenSections.length > 0 ? (
          <div className="profile-hidden-sections-bar">
            <Popover
              content={hiddenList}
              trigger="click"
              open={hiddenListOpen}
              onOpenChange={setHiddenListOpen}
            >
              <Button size="small">
                {t("profileLibrary.hiddenSections.button", { count: hiddenSections.length })}
              </Button>
            </Popover>
          </div>
        ) : null}
        {onlyBasicInfo ? (
          <EmptyState
            description={
              <span>
                <strong>{t("profileLibrary.empty.groupTitle")}</strong>
                <br />
                <span>{t("profileLibrary.empty.groupHint")}</span>
              </span>
            }
          >
            <div className="profile-section-empty-actions">
              <Button type="primary" onClick={() => setHiddenListOpen(true)}>
                {t("profileLibrary.empty.showHidden")}
              </Button>
              <Button type="link" size="small" onClick={onOpenGroupManager}>
                {t("profileGroups.control.manage")}
              </Button>
            </div>
          </EmptyState>
        ) : null}
      </ConfigProvider>
      {visibleSections.map((section) => {
        const order = sectionOrder.indexOf(section.key);
        return (
          <SortableProfileSection
            key={section.key}
            sectionKey={section.key}
            label={section.name}
            order={order >= 0 ? order : 0}
            editable={editing}
            reordering={reordering}
            dragging={draggingKey === section.key}
            compact={compact}
            collapsed={!editing && collapsedSections.has(section.key)}
            canMoveUp={order > 1}
            canMoveDown={order >= 0 && order < sectionOrder.length - 1}
            onToggleCollapsed={onToggleCollapsed}
            onHandlePointerDown={onHandlePointerDown}
            onMoveByOffset={onMoveByOffset}
            actions={sectionActions.get(section.key)}
          >
            {sectionContent.get(section.key)}
          </SortableProfileSection>
        );
      })}
    </div>
  );
}
