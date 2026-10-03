import { Card, Typography } from "antd";

export default function TemplateWorkbenchIntro() {
  return (
    <Card size="small" className="settings-card">
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        简历模板是什么
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        <b>样式模板</b>决定简历长什么样（配色、字体、标题样式），内置多种，也可以自制；
        <b>格式模板</b>决定排得多密（行高、页边距、强调色），只调参数、不用写代码。
        两者可以自由组合——例如“优雅样式 + 紧凑版式”。
      </Typography.Paragraph>
      <Typography.Title level={5}>工作台怎么用</Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        1. 想换个样子：从下面挑一个内置样式，点「复制改一份」开始编辑，右侧会实时预览； 2.
        想压进一页：用「自制版式」调行高与页边距，不用碰 HTML； 3.
        生成简历和预览简历时都能随时切换样式与版式，不会重新生成内容。
      </Typography.Paragraph>
    </Card>
  );
}
