/** 设置页「数据」分页的「隐私与数据主权」卡片：把隐私承诺说成用户看得懂的条款。 */

import { Card, Typography } from "antd";

export default function PrivacyCard() {
  return (
    <Card title="隐私与数据主权" className="settings-card">
      <Typography.Paragraph style={{ marginBottom: 12 }}>
        你的简历、岗位、资料与提醒都保存在<strong>本机</strong>的数据目录里（SQLite 数据库），
        应用没有账号体系、没有埋点上报，也不会把简历数据上传到任何服务器。
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        AI 功能只在你主动调用时，把完成任务所需的内容发送给你自己配置的模型服务商；
        服务商密钥保存在本机（Windows 上经系统级 DPAPI 加密）。诊断包（见「应用」分页的
        帮助与诊断）只含脱敏运行事件与日志尾部，不含简历数据与密钥。
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        <strong>带走数据</strong>：本页上方「导出备份包」随时可以把全部数据整份导出为 .zip。
        <strong>彻底删除</strong>：删除对应数据集即可；想删得干干净净，退出应用后直接删除
        数据目录（backend/data）即可，卸载不留残余。
      </Typography.Paragraph>
    </Card>
  );
}
