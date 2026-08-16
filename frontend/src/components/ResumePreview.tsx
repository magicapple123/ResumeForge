/** 简历预览：iframe 渲染后端返回的 HTML，附防虚构校验提醒。 */
import { Alert } from "antd";

interface Props {
  html: string;
  warnings: string[];
  height?: number;
}

export default function ResumePreview({ html, warnings, height = 560 }: Props) {
  return (
    <div>
      {warnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="发现以下内容需要人工核对（可能存在 AI 虚构）"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          }
        />
      )}
      {/* srcDoc 使用后端模板渲染的 HTML：模板已做自动转义，防 XSS */}
      <iframe title="简历预览" className="resume-iframe" height={height} srcDoc={html} />
    </div>
  );
}
