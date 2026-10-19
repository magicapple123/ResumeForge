/**
 * 外观：浅色 / 深色 / 跟随系统（R18）。
 *
 * 只有三档，没有"自定义配色"：这一版的目标是**外壳**在暗环境下不刺眼。
 * 简历预览始终按白纸渲染（导出与打印看到的就是那张纸），不跟着主题变——这是计划里
 * 明确的决策 D4，写在这里提醒后来者不要"顺手"把预览也改成深色。
 */
import { Card, Segmented, Typography } from "antd";
import { useThemeMode, setThemeMode, type ThemeMode } from "../../features/theme/themeStore";

const OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
];

export default function AppearanceCard() {
  const mode = useThemeMode();

  return (
    <Card className="settings-card appearance-card" title="主题外观">
      <Segmented
        aria-label="主题外观"
        value={mode}
        options={OPTIONS}
        onChange={(value) => setThemeMode(value as ThemeMode)}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
        深色只作用在应用界面（页头、侧栏、卡片、弹窗）。简历预览、导出的 PDF 与打印结果
        仍然是一张白纸——那是你要投出去的东西，不该跟着界面变。
      </Typography.Paragraph>
    </Card>
  );
}
