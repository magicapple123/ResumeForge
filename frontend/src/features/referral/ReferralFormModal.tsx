// SPDX-License-Identifier: Apache-2.0
/** 内推的新建 / 编辑弹窗：只包一层 Modal，表单字段全在 `ReferralFormFields` 里。
 *
 * 从 `ReferralPanel` 拆出只为控制文件长度：标题、按钮文案、上传状态透传都与拆前一致，
 * 表单实例与保存动作仍由面板持有。
 */
import { Modal } from "antd";
import type { FormInstance } from "antd";
import type { Referral, ReferralPayload } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import ReferralFormFields from "./ReferralFormFields";

interface Props {
  open: boolean;
  /** 非空表示编辑，空表示新建（只影响标题与保存走哪条接口）。 */
  editing: Referral | null;
  saving: boolean;
  form: FormInstance<ReferralPayload>;
  initialJobId: number | null;
  initialTrackId: number | null;
  noteImages: string[];
  uploadingImages: boolean;
  imageUploadPercent: number | null;
  beforeImageUpload: (file: File) => Promise<string | boolean> | string | boolean;
  removeImage: (path: string) => void;
  onCancel: () => void;
  onOk: () => void;
}

export default function ReferralFormModal({
  open,
  editing,
  saving,
  form,
  initialJobId,
  initialTrackId,
  noteImages,
  uploadingImages,
  imageUploadPercent,
  beforeImageUpload,
  removeImage,
  onCancel,
  onOk,
}: Props) {
  // 本文件用模块级 t()：必须订阅语言变化，否则切语言后弹窗标题与按钮不重渲染。
  useLocale();
  return (
    <Modal
      title={editing ? t("referralUi.form.title.edit") : t("referralUi.form.title.create")}
      open={open}
      onCancel={onCancel}
      onOk={onOk}
      confirmLoading={saving}
      okText={t("common.action.save")}
      cancelText={t("common.action.cancel")}
    >
      <ReferralFormFields
        form={form}
        initialJobId={initialJobId}
        initialTrackId={initialTrackId}
        noteImages={noteImages}
        uploadingImages={uploadingImages}
        imageUploadPercent={imageUploadPercent}
        beforeImageUpload={beforeImageUpload}
        removeImage={removeImage}
      />
    </Modal>
  );
}
