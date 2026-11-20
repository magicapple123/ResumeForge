// SPDX-License-Identifier: Apache-2.0
/**
 * 左栏「照片」页签（T02）：上传与取景的唯一完整入口。
 *
 * ## 为什么是**常驻**页签
 *
 * 不按"有没有照片"出现——没有照片的人正是要进来上传的那一类。所以页签一直在，
 * 里面没图时给一句空态 + 上传按钮。
 *
 * ## 为什么 `hasPhoto` 自己算
 *
 * 宿主传下来的 `hasPhoto` 来自**已保存的详情**，上传后不会变。用它控制裁剪/大小，
 * 就会出现"缩略图已经出来了，裁剪按钮还是灰的"——这不是加载慢，是读了另一份真相。
 * 这里一律用 `documentHasPhoto(document)`（当前文档），上传当拍即可用。
 *
 * ## 顺序
 *
 * 预览与操作 → 位置 → 大小 → 边框（`PhotoFrameFields` **直接铺开**，不再套按钮 + 弹层：
 * 页签本身就是低频面板，多一层点击只是让人找不到）。
 */
import { Select } from "antd";

import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ResumeLayout } from "../../../types";
import type { HeaderPlacement, ResumeDocument } from "../../../types/resumeDocument";
import {
  HEADER_PLACEMENT_LABEL_KEYS,
  HEADER_PLACEMENT_ORDER,
  isPhotoDataUrl,
} from "../document/headerOrder";
import { headerPath } from "../document/paths";
import { updateHeaderItem } from "../document/mutations";
import { documentHasPhoto } from "../document/view";
import { readPhotoCropFromFormatConfig, withPhotoCrop } from "../preview/photoCrop";
import {
  configuredPhotoScale,
  resolvePhotoScale,
  toPhotoPercent,
  withPhotoScale,
} from "../../../utils/pageMargins";
import PhotoAssetEditor from "./PhotoAssetEditor";
import PhotoFrameFields from "../layout/PhotoFrameFields";
import PhotoScaleControl from "../layout/PhotoScaleControl";

interface Props {
  document: ResumeDocument;
  layout: ResumeLayout;
  disabled?: boolean;
  onDocumentChange: (next: ResumeDocument) => void;
  onLayoutChange: (next: ResumeLayout) => void;
  onNotice?: (text: string, tone?: "info" | "warning") => void;
}

/**
 * 照片 item 的位置。页眉路径是 `header.<item_id>`（见 `document/paths.ts`），
 * 不是 `header.items.<index>` —— 写错不会报错，`updateHeaderItem` 会静默返回原文档。
 */
function locatePhoto(document: ResumeDocument): { path: string; index: number } | null {
  const index = document.header.items.findIndex((item) => item.key === "photo");
  if (index < 0) return null;
  return { path: headerPath(document.header.items[index].id), index };
}

export default function PhotoTab({
  document,
  layout,
  disabled = false,
  onDocumentChange,
  onLayoutChange,
  onNotice,
}: Props) {
  useLocale();
  const located = locatePhoto(document);
  const rawValue = located ? document.header.items[located.index].value : "";
  const photo = isPhotoDataUrl(rawValue) ? rawValue : "";
  const formatConfig = layout.format_config;
  const crop = readPhotoCropFromFormatConfig(formatConfig);
  const hasPhoto = documentHasPhoto(document);
  const notify = onNotice ?? (() => undefined);

  const patchItem = (value: string) => {
    if (!located) return;
    onDocumentChange(updateHeaderItem(document, located.path, { value }));
  };

  const patchPlacement = (placement: HeaderPlacement) => {
    if (!located) return;
    onDocumentChange(updateHeaderItem(document, located.path, { placement }));
  };

  /** 换图 / 移图：`photo_crop` 的 sha 指向旧图，必须同批清掉。 */
  const changePhoto = (dataUrl: string) => {
    patchItem(dataUrl);
    if (crop) onLayoutChange({ ...layout, format_config: withPhotoCrop(formatConfig, null) });
  };

  const percent = toPhotoPercent(resolvePhotoScale(formatConfig));
  const customizedScale = configuredPhotoScale(formatConfig);

  return (
    <div className="resume-photo-tab">
      <PhotoAssetEditor
        photo={photo}
        crop={crop}
        disabled={disabled}
        variant="full"
        onPhotoChange={changePhoto}
        onCropChange={(params) =>
          onLayoutChange({ ...layout, format_config: withPhotoCrop(formatConfig, params) })
        }
        onNotice={notify}
      />

      {located ? (
        <label className="resume-photo-tab__row">
          <span className="resume-photo-tab__label">{t("document.placement.short")}</span>
          <Select
            size="small"
            aria-label={t("document.placement.aria")}
            value={document.header.items[located.index].placement}
            disabled={disabled}
            style={{ width: 160 }}
            onChange={patchPlacement}
            options={HEADER_PLACEMENT_ORDER.map((placement) => ({
              value: placement,
              label: t(HEADER_PLACEMENT_LABEL_KEYS[placement]),
            }))}
          />
        </label>
      ) : null}

      <div className="resume-photo-tab__block">
        <PhotoScaleControl
          value={percent}
          customized={customizedScale !== null}
          hasPhoto={hasPhoto}
          disabled={disabled}
          defaultHint={t("resume.measure.hintTemplate")}
          onChange={(next) =>
            onLayoutChange({ ...layout, format_config: withPhotoScale(formatConfig, next) })
          }
        />
      </div>

      <div className="resume-photo-tab__block resume-photo-frame-panel">
        <PhotoFrameFields
          formatConfig={formatConfig}
          hasPhoto={hasPhoto}
          disabled={disabled}
          onChange={(next) => onLayoutChange({ ...layout, format_config: next })}
        />
      </div>
    </div>
  );
}
