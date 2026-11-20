// SPDX-License-Identifier: Apache-2.0
/**
 * 左栏「排版参数」里的「照片」分组（T02；5.1 从独立页签并入）。
 *
 * ## 为什么是**常驻**分组
 *
 * 不按"有没有照片"出现——没有照片的人正是要进来上传的那一类。所以分组一直在，
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
 * 预览与操作 → 大小 → 边框（`PhotoFrameFields` **直接铺开**，不再套按钮 + 弹层：
 * 分组本身就是低频面板，多一层点击只是让人找不到）。
 *
 * ## 位置固定为 `photo`
 *
 * 5.3：照片不再提供「位置」下拉（换位 / 隐藏）。存量 `placement !== "photo"` 的归一
 * 由后端在文档读取入口完成；本组件只写 `value` / `format_config`，从不写 `placement`。
 */
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ResumeLayout } from "../../../types";
import type { ResumeDocument } from "../../../types/resumeDocument";
import { isPhotoDataUrl } from "../document/headerOrder";
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
