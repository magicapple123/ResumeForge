// SPDX-License-Identifier: Apache-2.0
/**
 * 「新建板块（仅本份简历）」弹窗（任务 11）。
 *
 * ## 为什么只在这一处给入口
 *
 * 页签末尾那颗「+」是中栏唯一说得清"我现在往这份简历里加东西"的位置；左栏的「本份简历结构」
 * 讲的是已有板块的字段与顺序，不承担新增。资料库里的"自建板块"是另一个概念（跨简历复用的
 * 分区定义），所以文案刻意区分成「新建板块（仅本份简历）」，不叫「自建板块」。
 *
 * ## 三个必须说清的点（都写在弹窗里，不指望用户去别处发现）
 *
 * 1. **名字没有改名入口**：`title_override` 目前没有编辑 UI，所以名字必须一次输对；
 * 2. **「从资料填入」填不进**：资料库里没有这个 key，填空菜单不会包含它；
 * 3. **只在当前这份简历里**：它不进资料库，也不影响别的简历。
 *
 * ## 关闭语义
 *
 * 有提交动作（会往文档里写一个板块），按 AGENTS 的弹层规范禁掉蒙层关闭；
 * `×` 与 Esc 同义（`onCancel`），已输入的标题会随关闭丢弃——这里只是两三个字的草稿，
 * 不值得为它再叠一层「放弃输入？」确认。
 */
import { Input, Modal, Typography } from "antd";
import { useEffect, useState } from "react";
import { useI18n } from "../../../i18n/i18nContext";

/** 与后端 `ResumeSection.title` 的 `max_length` 一致。 */
const TITLE_MAX_LENGTH = 64;

interface Props {
  open: boolean;
  onClose: () => void;
  /** 确认后回传**已 trim** 的板块名（调用方负责生成 key 并写进文档）。 */
  onCreate: (title: string) => void;
}

export default function AddSectionModal({ open, onClose, onCreate }: Props) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");

  // 每次打开都从空开始：上一次输了一半的名字不该悄悄跟着下一次。
  useEffect(() => {
    if (open) setTitle("");
  }, [open]);

  const trimmed = title.trim();

  const submit = () => {
    if (!trimmed) return;
    onCreate(trimmed);
    onClose();
  };

  return (
    <Modal
      open={open}
      title={t("document.section.addTitle")}
      onCancel={onClose}
      // 这个弹窗会往文档里写东西：蒙层不关闭，避免点外面把正在输入的名字丢掉。
      mask={{ closable: false }}
      okText={t("document.section.addConfirm")}
      cancelText={t("common.action.cancel")}
      okButtonProps={{ disabled: !trimmed }}
      onOk={submit}
    >
      <Input
        autoFocus
        value={title}
        maxLength={TITLE_MAX_LENGTH}
        aria-label={t("document.section.titleLabel")}
        placeholder={t("document.section.titleLabel")}
        onChange={(event) => setTitle(event.target.value)}
        onPressEnter={submit}
      />
      <Typography.Paragraph type="secondary" style={{ margin: "10px 0 0", fontSize: 12 }}>
        {t("document.section.addBody")}
        <br />
        {t("document.section.addNameHint")}
      </Typography.Paragraph>
    </Modal>
  );
}
