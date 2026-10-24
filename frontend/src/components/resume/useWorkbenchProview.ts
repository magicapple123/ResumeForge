// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台 → 专业视图（W15）的宿主能力注入（从 `ResumeZoomModal` 拆出）。
 *
 * `ProviewProvider` 只要一份"能力与回调"：命令面板把工作台已有的保存/导出并进命令列表，
 * 工作区预设由**外壳**持有（面板显隐只有外壳能改），照片入口走宿主已有的内容保存链路。
 * 没有注入的能力对应按钮不渲染——所以这里只放真实有 handler 的命令。
 *
 * 拆成 hook 的原因：外壳文件贴着 500 行预算；挂载点只是"把这份配置交给画布"。
 */
import { useMemo } from "react";
import type { ResumeContent, ResumeLayout } from "../../types";
import type { ProviewShellConfig } from "../../features/resume-proview/ProviewContext";
import type { ProviewCommand } from "../../features/resume-proview/types";
import {
  readPhotoCropFromFormatConfig,
  withPhotoCrop,
} from "../../features/resume-proview/photoCrop";
import { useWorkspacePreset } from "../../features/resume-proview/workspacePresets";
import type { WorkspacePanels } from "../../features/resume-proview/types";
import { formatShortcut } from "../../features/shortcuts/matchShortcut";
import { useShortcutSettings } from "../../features/shortcuts/useShortcutKeymap";
import { shortcutKeysOf } from "../../features/shortcuts/storage";
import { t } from "../../i18n";

interface Options {
  resumeId?: number;
  content?: ResumeContent | null;
  /** 制作台动作条的"保存修改"（命令面板里的保存与它同一条链路）。 */
  save: () => Promise<void>;
  onExport?: () => void;
  /** 宿主的内容保存通道（照片移除用）；缺省 = 不提供移除按钮。 */
  onSaveContent?: (content: ResumeContent) => Promise<number | void>;
  /** 当前版式草稿：照片裁剪参数存在 format_config.photo_crop。 */
  layout?: ResumeLayout | null;
  /** 版式变化落点（制作台传 history.recordLayout：裁剪也进历史、走既有保存链路）。 */
  onApplyLayout?: (next: ResumeLayout) => void;
}

export interface WorkbenchProview {
  /** 交给画布（经 `ResumeWorkbenchLiveCanvas` 的 proview prop）的能力集合。 */
  proview: ProviewShellConfig;
  /** 当前工作区预设决定的面板可见性（画布恒开）。 */
  panels: WorkspacePanels;
}

export function useWorkbenchProview({
  resumeId,
  content,
  save,
  onExport,
  onSaveContent,
  layout,
  onApplyLayout,
}: Options): WorkbenchProview {
  const { preset, panels, setPreset, reset } = useWorkspacePreset();
  const settings = useShortcutSettings();

  const commands = useMemo<ProviewCommand[]>(() => {
    const list: ProviewCommand[] = [
      {
        id: "save",
        label: t("proview.cmd.save"),
        keywords: ["persist"],
        shortcut: formatShortcut(shortcutKeysOf(settings, "save")[0] ?? "mod+s"),
        run: () => void save(),
      },
    ];
    if (onExport) {
      list.push({
        id: "export",
        label: t("proview.cmd.export"),
        keywords: ["download"],
        shortcut: formatShortcut(shortcutKeysOf(settings, "exportPdf")[0] ?? "mod+shift+e"),
        run: onExport,
      });
    }
    return list;
  }, [onExport, save, settings]);

  const photo = useMemo<ProviewShellConfig["photo"]>(() => {
    if (!content?.photo) return undefined;
    const photoContent = content;
    return {
      photo: photoContent.photo,
      // 沿宿主的"内容保存即转正"链路：不新增接口，也不绕过 W02 状态机。
      onRemovePhoto: onSaveContent
        ? () => {
            void onSaveContent({ ...photoContent, photo: "" });
          }
        : undefined,
      // W15 照片裁剪：读 format_config.photo_crop；改完写回既有版式保存链路（history.recordLayout）。
      crop: readPhotoCropFromFormatConfig(layout?.format_config),
      onCropChange:
        layout && onApplyLayout
          ? (params) =>
              onApplyLayout({
                ...layout,
                format_config: withPhotoCrop(layout.format_config, params),
              })
          : undefined,
    };
  }, [content, layout, onApplyLayout, onSaveContent]);

  return {
    proview: {
      resumeId,
      commands,
      workspace: { value: preset, onChange: setPreset, onReset: reset },
      photo,
    },
    panels,
  };
}
