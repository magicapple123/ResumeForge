// SPDX-License-Identifier: Apache-2.0
/**
 * 「本条要发」的配图（R21）：横向缩略图槽 + 可折叠图片库 + 灯箱。
 *
 * ## 这一版把三件事拆开了
 *
 * 上一版把"这条要发什么"和"图库里有什么"塞进同一个列表，于是编辑一条队列行时看到的是一长列
 * 带垃圾桶的文件名（`candidate-1-1`、`job-13-note-1`…）。三处语义在这里被分开：
 *
 * | 区域        | 含义                       | 能做的动作                     |
 * | --------- | ------------------------ | -------------------------- |
 * | 缩略图槽      | **这一条投递要发的图**（最多 4 张）    | 点开灯箱预览、`×` 从这一条移除         |
 * | 空槽        | 没选 = 跟随投递设置里的默认图         | 无（纯说明）                     |
 * | 图片库（折叠）   | 库里的全部候选                  | 勾选 / 取消勾选、上传                |
 *
 * **`×` 不删库**：它只把 id 从这一条的值里摘掉，不调任何删除接口。删库是图片库管理动作，
 * 入口只留在「投递设置 → 附带图片」——在"编辑这一条投递"的语境里放删库按钮，语义是错的
 * （这也是 R21 那条"点不掉、又不敢点"的根源）。
 *
 * ## 第 5 张为什么不静默忽略
 *
 * 上限是硬限制（`maxCount` 来自后端）。到顶时「选择图片」按钮直接置灰，并且下方常驻一句
 * 「已达 N 张上限，先移除一张再加」；库里未选中的图也一并置灰。按钮不解释原因等于让用户
 * 反复试，而"点了没反应"会被读成"坏了"。
 */
import { UploadOutlined } from "@ant-design/icons";
import { App, Button, Collapse, Upload } from "antd";
import { useId, useRef, useState } from "react";
import { userFileRawUrl } from "../../api/userFiles";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ApplyGreetingImageOption } from "../../types";
import { formatBytes } from "../../utils/format";
import GreetingImageLightbox, { type GreetingImagePreviewTarget } from "./GreetingImageLightbox";
import {
  greetingImageLimit,
  greetingImageSignature,
  removeGreetingImage,
  resolveGreetingImages,
  toggleGreetingImage,
} from "./greetingImageSelection";
import { useGreetingImagePaste, useGreetingImageUpload } from "./useGreetingImageUpload";
import "./greetingImages.css";

export interface GreetingImageMultiSelectProps {
  /** 由 `Form.Item` 注入；也允许直接当受控组件用。 */
  value?: number[] | null;
  onChange?: (next: number[]) => void;
  options: ApplyGreetingImageOption[];
  /** 后端下发的张数上限（`attachments.max_count`）。 */
  maxCount?: number;
  /** 后端下发的单张体积上限（`max_image_bytes`）；缺省时用同源镜像常量。 */
  maxImageBytes?: number;
  disabled?: boolean;
  /** 空槽上那句说明；来自调用方的 placeholder，缺省用通用文案。 */
  placeholder?: string;
  ariaLabel: string;
}

const LIBRARY_KEY = "library";

/** 托盘里一条失败记录：文件本体留着才能重试，`reason` 是已本地化的整句。 */
interface GreetingImageFailure {
  id: number;
  file: File;
  reason: string;
}

export default function GreetingImageMultiSelect({
  value,
  onChange,
  options,
  maxCount,
  maxImageBytes,
  disabled,
  placeholder,
  ariaLabel,
}: GreetingImageMultiSelectProps) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块停在旧文案。
  useLocale();
  const { message } = App.useApp();
  const noteId = useId();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [preview, setPreview] = useState<GreetingImagePreviewTarget | null>(null);
  // 失败的那张留在托盘里可重试：`File` 对象在浏览器里还能再读一次，没必要让用户重选。
  const [failures, setFailures] = useState<GreetingImageFailure[]>([]);
  const failureSeq = useRef(0);
  // antd 的 `multiple` 会对每个文件各调一次 `beforeUpload`；串成一条链，保证提示顺序与
  // 用户选择顺序一致，同时避免同一批文件并发挤爆后端。
  const uploadChain = useRef<Promise<void>>(Promise.resolve());

  // 渲染期镜像同步（与设置页同一模式）：父组件每次渲染都新建数组，按签名判断"真的变了"
  // 再灌一次本地副本——上传后要把新图留在库里，不能每渲染一次就退回父组件的旧快照。
  const signature = greetingImageSignature(options);
  const [items, setItems] = useState(options);
  const [sourceSignature, setSourceSignature] = useState(signature);
  if (signature !== sourceSignature) {
    setSourceSignature(signature);
    setItems(options);
  }

  const selectedIds: number[] = Array.isArray(value) ? value : [];
  const limit = greetingImageLimit(maxCount);
  const resolved = resolveGreetingImages(selectedIds, items);
  const atMax = selectedIds.length >= limit;

  const commit = (next: number[]) => onChange?.(next);

  /**
   * 把这一批**上传成功**的图追加进已选。
   *
   * 一批只提交一次：逐张回调里各自 `commit` 的话，第二次读到的 `value` 还是上传前的旧值
   * （父组件的重渲染赶不上同一 tick），会把前一张覆盖掉。满额时多出来的那几张仍在库里，
   * 只是不进这一条——并明确提示原因，而不是静默少选。
   */
  const commitUploaded = (options: ApplyGreetingImageOption[]): void => {
    if (options.length === 0) return;
    let next = selectedIds;
    let blocked = 0;
    for (const option of options) {
      const result = toggleGreetingImage(next, option.id, limit);
      if (result.blocked) blocked += 1;
      else next = result.next;
    }
    if (next !== selectedIds) commit(next);
    if (blocked > 0) message.warning(t("applyQueue.image.maxReached", { count: limit }));
  };

  const { uploading, uploadMany } = useGreetingImageUpload((option) => {
    setItems((previous) =>
      previous.some((item) => item.id === option.id) ? previous : [...previous, option],
    );
  }, maxImageBytes);

  /**
   * 一次上传的收尾：成功的追加进这一条，失败的进托盘等重试。
   */
  const runUpload = async (files: File[]): Promise<void> => {
    const outcomes = await uploadMany(files);
    commitUploaded(
      outcomes
        .map((item) => item.option)
        .filter((item): item is ApplyGreetingImageOption => item !== null),
    );
    const failed = outcomes.filter((item) => item.option === null);
    if (failed.length === 0) return;
    setFailures((previous) => [
      ...previous,
      ...failed.map((item) => {
        failureSeq.current += 1;
        return { id: failureSeq.current, file: item.file, reason: item.reason ?? "" };
      }),
    ]);
  };

  const enqueue = (files: File[]): void => {
    uploadChain.current = uploadChain.current.then(() => runUpload(files)).then(() => undefined);
  };

  // 粘贴与「选择文件」走同一个 `runUpload`：校验、体积上限、逐张回报都只有一份实现。
  useGreetingImagePaste((files) => enqueue(files), !disabled);

  const retryFailure = async (failure: GreetingImageFailure): Promise<void> => {
    // 重试不走 `runUpload`：失败时要把原因**换掉**，而不是在托盘里再叠一条同样的记录。
    const [outcome] = await uploadMany([failure.file]);
    if (!outcome) return;
    if (outcome.option) {
      commitUploaded([outcome.option]);
      setFailures((previous) => previous.filter((item) => item.id !== failure.id));
      return;
    }
    setFailures((previous) =>
      previous.map((item) =>
        item.id === failure.id ? { ...item, reason: outcome.reason ?? item.reason } : item,
      ),
    );
  };

  const dismissFailure = (id: number): void => {
    setFailures((previous) => previous.filter((item) => item.id !== id));
  };

  const handleRemove = (id: number) => {
    // 只改这一条的值：**不调用** deleteGreetingImage，图库里那张图仍然在。
    commit(removeGreetingImage(selectedIds, id));
    message.info(t("applyQueue.image.removeOnly"));
  };

  const handleToggle = (id: number) => {
    const result = toggleGreetingImage(selectedIds, id, limit);
    if (result.blocked) {
      message.warning(t("applyQueue.image.maxReached", { count: limit }));
      return;
    }
    commit(result.next);
  };

  const libraryLabel = (
    <span className="rf-greeting-library-label">
      <span className="rf-greeting-library-title">{t("applyQueue.image.library")}</span>
      <span className="rf-greeting-library-count">
        {t("applyQueue.image.librarySummary", {
          total: items.length,
          count: selectedIds.length,
        })}
      </span>
    </span>
  );

  return (
    <div className="rf-greeting-picker" role="group" aria-label={ariaLabel}>
      <div className="rf-greeting-slots">
        {selectedIds.length === 0 && (
          // 没选任何图 ≠ 不发图：这时这条投递用的是投递设置里的默认图。
          <div className="rf-greeting-slot rf-greeting-slot-follow">
            <span className="rf-greeting-slot-follow-title">
              {t("applyQueue.image.followDefault")}
            </span>
            <span className="rf-greeting-slot-follow-hint">
              {placeholder ?? t("applyQueue.image.editorPlaceholder")}
            </span>
          </div>
        )}
        {resolved.map((item) => (
          <div className="rf-greeting-slot" key={item.id}>
            <button
              type="button"
              className="rf-greeting-slot-preview"
              onClick={() => setPreview(item)}
              // 文件名只做 tooltip / 读屏名：缩略图槽里再排一行文件名只会把"垃圾键"搬个位置。
              title={item.name}
              aria-label={t("applyQueue.image.previewAria", { name: item.name })}
            >
              <img src={userFileRawUrl(item.id)} alt="" loading="lazy" />
            </button>
            <button
              type="button"
              className="rf-greeting-slot-remove"
              onClick={() => handleRemove(item.id)}
              disabled={disabled}
              aria-label={t("applyQueue.image.removeAria", { name: item.name })}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="rf-greeting-slot rf-greeting-slot-add"
          onClick={() => setLibraryOpen((previous) => !previous)}
          disabled={disabled || atMax}
          aria-expanded={libraryOpen}
          aria-describedby={atMax ? noteId : undefined}
          aria-label={t("applyQueue.image.addTileAria", {
            count: selectedIds.length,
            max: limit,
          })}
        >
          <span className="rf-greeting-slot-add-icon" aria-hidden="true">
            +
          </span>
          <span className="rf-greeting-slot-add-text">{t("applyQueue.image.addTile")}</span>
          <span className="rf-greeting-slot-add-count">{`${selectedIds.length} / ${limit}`}</span>
        </button>
      </div>

      {atMax && (
        // `role="status"`：到顶这件事要能被读屏念出来，而不是只有颜色变灰。
        <p className="rf-greeting-image-note rf-greeting-image-note-warn" id={noteId} role="status">
          {t("applyQueue.image.maxReached", { count: limit })}
        </p>
      )}
      <p className="rf-greeting-image-note">{t("applyQueue.image.removeOnlyHint")}</p>

      {/* 失败托盘放在折叠区**外面**：粘贴时图片库可能是收起的，失败原因必须一眼看得见，
          且每张都带重试——重选一次文件比"再粘一遍"更麻烦。 */}
      {failures.length > 0 && (
        <div className="rf-greeting-failures" role="status" aria-live="polite">
          <p className="rf-greeting-image-note rf-greeting-image-note-warn">
            {t("applyQueue.image.failedTray")}
          </p>
          {failures.map((failure) => (
            <div className="rf-greeting-failure" key={failure.id}>
              <span className="rf-greeting-failure-name" title={failure.file.name}>
                {failure.file.name}
              </span>
              <span className="rf-greeting-failure-reason">{failure.reason}</span>
              <Button size="small" onClick={() => void retryFailure(failure)} disabled={disabled}>
                {t("applyQueue.image.retry")}
              </Button>
              <Button
                size="small"
                type="text"
                onClick={() => dismissFailure(failure.id)}
                aria-label={t("applyQueue.image.dismissFailureAria", { name: failure.file.name })}
              >
                {t("applyQueue.image.dismissFailure")}
              </Button>
            </div>
          ))}
        </div>
      )}

      <Collapse
        className="rf-greeting-library"
        activeKey={libraryOpen ? [LIBRARY_KEY] : []}
        onChange={(keys) => {
          const next = Array.isArray(keys) ? keys : [keys];
          setLibraryOpen(next.includes(LIBRARY_KEY));
        }}
        items={[
          {
            key: LIBRARY_KEY,
            label: libraryLabel,
            children: (
              <div className="rf-greeting-library-body">
                <div className="rf-greeting-library-actions">
                  {/* `accept` 只是让对话框默认筛图片；真正的判定在 `runUpload` 里按
                      MIME + 扩展名 + 体积逐张做，粘贴走的是同一条路。 */}
                  <Upload
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    multiple
                    showUploadList={false}
                    disabled={disabled || uploading}
                    beforeUpload={(file) => {
                      enqueue([file as File]);
                      return Upload.LIST_IGNORE;
                    }}
                  >
                    <Button
                      size="small"
                      icon={<UploadOutlined />}
                      loading={uploading}
                      disabled={disabled}
                    >
                      {t("applyQueue.image.upload")}
                    </Button>
                  </Upload>
                  <span className="rf-greeting-library-paste-hint">
                    {t("applyQueue.image.pasteHint")}
                  </span>
                </div>
                {items.length === 0 ? (
                  <p className="rf-greeting-image-note">{t("applyQueue.image.libraryEmpty")}</p>
                ) : (
                  <div className="rf-greeting-library-grid">
                    {items.map((item) => {
                      const selected = selectedIds.includes(item.id);
                      const blocked = !selected && atMax;
                      const label = t("applyQueue.image.toggleAria", {
                        name: item.name,
                        size: formatBytes(item.size_bytes),
                      });
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`rf-greeting-thumb${selected ? " is-selected" : ""}`}
                          aria-pressed={selected}
                          disabled={disabled || blocked}
                          title={
                            blocked ? t("applyQueue.image.maxReached", { count: limit }) : label
                          }
                          aria-label={label}
                          onClick={() => handleToggle(item.id)}
                        >
                          <img src={userFileRawUrl(item.id)} alt="" loading="lazy" />
                          {selected && (
                            <span className="rf-greeting-thumb-check" aria-hidden="true">
                              ✓
                            </span>
                          )}
                          {!item.deletable && (
                            <span className="rf-greeting-thumb-used">
                              {t("applyQueue.image.inUse")}
                            </span>
                          )}
                          <span className="rf-greeting-thumb-name">{item.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {/* 边界写在界面上：这里只选不发删，删库在投递设置里。 */}
                <p className="rf-greeting-image-note">{t("applyQueue.image.manageInSettings")}</p>
              </div>
            ),
          },
        ]}
      />

      <GreetingImageLightbox image={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
