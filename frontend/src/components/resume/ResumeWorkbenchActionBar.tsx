// SPDX-License-Identifier: Apache-2.0
/**
 * 简历制作台的**标题行 = 动作条**：56px 一行放"标题 + 简历名 + 草稿提示 + 保存/取消 + 导出 + ×"。
 *
 * 为什么单独成文件：`ResumeZoomModal` 是"外壳 + 三栏 + 动作条"的组合根，已贴到单文件 500 行
 * 预算；而这一条是**纯展示**——它只把宿主给的状态翻译成几颗按钮，一行状态判断都不自己做
 * （脏值、就绪态、正在飞的那几步全由 `useWorkbenchOverallSave` 与弹窗持有）。
 *
 * 三条形态规则（都由用户口径驱动，改之前先读这里）：
 *
 * 1. **只在有东西可做时出现按钮**：有改动（内容脏 / 版式与打开时不同）或这还是一份草稿。
 *    一颗常亮的主按钮会让"有没有改动"失去信号；而草稿必须常驻——刚建出来的草稿内容与
 *    版式都没动过，没有它用户就永远没法让这份简历进入简历中心（0051）。
 * 2. **草稿且干净时只给一颗**：文案换成「保存到简历中心」，旁边不摆「取消修改」（没有
 *    "修改"可取消，只有右侧 × 上的关闭）。
 * 3. **「取消修改」就地换态**：确认句必须长在用户刚才点的地方，不能掉到中栏底部。
 *
 * 关闭确认（`Popconfirm`）也挂在这条最右的 × 上：用户按的是关闭，卡片就该在那儿展开。
 * 判断不在这里做——本组件只把 `onClick` 的开关信号原样交回宿主（`onCloseRequest`），
 * 由它决定"直接关"还是"亮卡片"。
 */
import {
  CloseOutlined,
  DownloadOutlined,
  EditOutlined,
  SaveOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Button, Popconfirm, Typography } from "antd";
import type { MessageKey } from "../../i18n";
import { t } from "../../i18n";

interface Props {
  /** 这份简历的名字（没有名字时不渲染那一段）。 */
  resumeName?: string;
  /** 中栏编辑器是否可用：没有它就没有"整体保存"这回事。 */
  editorEnabled: boolean;
  /** 内容脏 **或** 版式与打开制作台时不同。 */
  dirty: boolean;
  /** 这还是一份没保存过的草稿。 */
  isDraft: boolean;
  /** W02：停在 409 冲突态。保存/取消都禁用——正文上方的三选一才是唯一出口。 */
  conflict: boolean;
  /** 上一次保存失败（非冲突）：留一句"改动还留着"，保存按钮就是重试入口。 */
  saveFailed: boolean;
  /** 版式 PATCH 在飞。 */
  layoutSaving: boolean;
  /** 内容 PATCH 在飞。 */
  editorSaving: boolean;
  /** 整体保存的两步正在跑。 */
  saving: boolean;
  /** 「取消修改」被按过、就地确认条正亮着。 */
  discardConfirm: boolean;
  /** 关闭确认卡片正亮着。 */
  closeConfirmOpen: boolean;
  /** 关闭卡片的描述文案（按"丢的是什么"由宿主选好）。 */
  closeBody: MessageKey;
  onSave: () => void;
  /** `true` = 亮起「取消修改」的就地确认条。 */
  onRequestDiscardConfirm: (next: boolean) => void;
  /** 确认放弃本次修改（内容回填 + 版式回滚）。 */
  onDiscard: () => void;
  onExport?: () => void;
  /** W11 统一检查入口；不传 = 只读宿主，不渲染按钮。 */
  onOpenPreflight?: () => void;
  /** W13 版本入口；不传不渲染。 */
  onOpenVersions?: () => void;
  /**
   * 内容栏不在栅格里时（两栏 / 单栏）的入口。不传 = 三栏，不渲染按钮——
   * 常驻的按钮会让"内容栏在哪"变成一个需要判断的问题。
   */
  onOpenContent?: () => void;
  /** 参数栏也不在栅格里时（单栏）的入口。 */
  onOpenParams?: () => void;
  /** × 的开关信号：`true` = 有人想关，`false` = 卡片被取消。 */
  onCloseRequest: (next: boolean) => void;
  /** 卡片里点了「放弃并关闭」。 */
  onCloseConfirmed: () => void;
}

export default function ResumeWorkbenchActionBar({
  resumeName,
  editorEnabled,
  dirty,
  isDraft,
  conflict,
  saveFailed,
  layoutSaving,
  editorSaving,
  saving,
  discardConfirm,
  closeConfirmOpen,
  closeBody,
  onSave,
  onRequestDiscardConfirm,
  onDiscard,
  onExport,
  onOpenPreflight,
  onOpenVersions,
  onOpenContent,
  onOpenParams,
  onCloseRequest,
  onCloseConfirmed,
}: Props) {
  // 有东西可做：有改动，或这是一份还没保存的草稿。
  const hasWork = editorEnabled && (dirty || isDraft);
  return (
    <div className="resume-wb-actionbar" aria-label={t("workbench.title")}>
      <span className="resume-wb-actionbar-title">{t("workbench.title")}</span>
      {resumeName ? <span className="resume-wb-actionbar-name">{resumeName}</span> : null}
      {/* 草稿态：说清"现在还看不见它"，否则用户会以为保存已经发生（简历中心里没有它）。 */}
      {isDraft && !dirty ? (
        <Typography.Text type="secondary" className="resume-wb-actionbar-hint">
          {t("workbench.draft.hint")}
        </Typography.Text>
      ) : null}
      {/* 保存失败：动作条是用户刚才点的地方，把"改动还在"这句话放在这里；重试入口就是
          保存按钮本身（不禁用它——失败后用户最需要的就是再点一次）。 */}
      {saveFailed && !conflict ? (
        <Typography.Text type="danger" className="resume-wb-actionbar-hint">
          {t("workbench.conflict.save-failed")}
        </Typography.Text>
      ) : null}
      <span className="resume-wb-actionbar-spacer" />
      {hasWork && dirty && discardConfirm ? (
        // 复用 `.rf-form-modal-discard`：与弹窗、编辑器里的确认是同一种视觉语言，
        // 也不再新开第二层弹窗（这一屏本来就是一个整屏弹窗）。
        <div
          className="rf-form-modal-discard resume-wb-actionbar-discard"
          role="alert"
          aria-live="assertive"
        >
          <span className="rf-form-modal-discard-text">
            {t("workbench.actionbar.discard.body")}
          </span>
          <Button size="small" onClick={() => onRequestDiscardConfirm(false)}>
            {t("common.action.keep-editing")}
          </Button>
          <Button size="small" danger onClick={onDiscard}>
            {t("common.action.discard")}
          </Button>
        </div>
      ) : hasWork ? (
        <>
          <Button
            size="small"
            type="primary"
            icon={<SaveOutlined />}
            // 版式 PATCH 与内容 PATCH 任一在飞都上 loading：这两步在 `useWorkbenchOverallSave`
            // 里是串行的（先版式后内容），只在内容那一步转圈会让前一段看起来像点了没反应。
            loading={editorSaving || saving}
            // 版式 PATCH 在飞时禁用：那段时间落库只会返回 `false`，点得下去就等于
            // "点了没反应、内容也没存"，不如直接不给点。
            // 冲突态也禁用：再点一次保存 = 硬覆盖，正是 W02 要消灭的那条路。
            disabled={saving || layoutSaving || conflict}
            onClick={onSave}
          >
            {/* 一个字都没改时写「保存修改」会让人以为按钮坏了：这次点击做的事是
                "让这份简历出现在简历中心"。 */}
            {dirty ? t("workbench.action.save-changes") : t("workbench.action.publish")}
          </Button>
          {/* 草稿且干净时没有"修改"可取消，只有关闭（在右侧 × 上）——多一颗取消修改
              只会制造"我取消了什么"的疑问。 */}
          {dirty ? (
            <Button
              size="small"
              // 冲突态连"取消修改"也禁用：本地这份是基于旧版本改的，丢弃之后编辑器会回填
              // 服务端**旧**内容（不是最新版），用户会以为放弃成功了、其实看到的是过期数据。
              disabled={editorSaving || saving || conflict}
              onClick={() => onRequestDiscardConfirm(true)}
            >
              {t("workbench.action.cancel-changes")}
            </Button>
          ) : null}
        </>
      ) : null}
      {onOpenParams ? (
        <Button size="small" icon={<SettingOutlined />} onClick={onOpenParams}>
          {t("responsive.action.params")}
        </Button>
      ) : null}
      {onOpenContent ? (
        <Button size="small" icon={<EditOutlined />} onClick={onOpenContent}>
          {t("responsive.action.editContent")}
        </Button>
      ) : null}
      {onExport ? (
        <Button size="small" icon={<DownloadOutlined />} onClick={onExport}>
          {t("export.action.export")}
        </Button>
      ) : null}
      {onOpenPreflight ? (
        <Button size="small" onClick={onOpenPreflight} aria-label={t("preflight.action.openAria")}>
          {t("preflight.action.open")}
        </Button>
      ) : null}
      {onOpenVersions ? (
        <Button size="small" onClick={onOpenVersions} aria-label={t("versions.action.openAria")}>
          {t("versions.action.open")}
        </Button>
      ) : null}
      {/* 自绘的 ×：弹窗 `closable={false}` 之后这是唯一能"就地"问一句的地方——卡片就长在
          用户刚点的那颗按钮上。干净时它就是个普通关闭，不弹任何东西。 */}
      <Popconfirm
        open={closeConfirmOpen}
        onOpenChange={onCloseRequest}
        title={t("workbench.close.title")}
        description={t(closeBody)}
        okText={t("workbench.close.confirm")}
        cancelText={t("common.action.keep-editing")}
        okButtonProps={{ danger: true }}
        onConfirm={onCloseConfirmed}
        // 卡片比动作条宽得多：默认居中会把它推到屏幕外，右对齐才贴着 × 展开。
        placement="bottomRight"
      >
        <Button
          size="small"
          type="text"
          icon={<CloseOutlined />}
          aria-label={t("common.action.close")}
        />
      </Popconfirm>
    </div>
  );
}
