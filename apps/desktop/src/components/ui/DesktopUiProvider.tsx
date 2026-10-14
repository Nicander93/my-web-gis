import type { ReactNode } from 'react'
import { App, ConfigProvider, type ThemeConfig } from 'antd'
import zhCN from 'antd/locale/zh_CN'

/** Ant Design controls share the approved workbench palette and desktop density. */
const desktopTheme: ThemeConfig = {
  token: {
    colorPrimary: '#2f695b', colorBgLayout: '#f7f9f6', colorBgContainer: '#fafbf9',
    colorBorder: '#dfe4e2', colorText: '#252522', colorTextSecondary: '#74736d', colorError: '#a64c47',
    fontFamily: "'Segoe UI', 'Microsoft YaHei UI', system-ui, 'Noto Sans SC', sans-serif",
    fontSize: 12, borderRadius: 4, controlHeight: 30, controlHeightSM: 26, motion: false
  },
  components: {
    Button: { paddingInlineSM: 8 },
    Tabs: { horizontalItemPaddingSM: '5px 8px', cardHeightSM: 28 },
    Modal: { titleFontSize: 14 }
  }
}

export function DesktopUiProvider({ children }: { children: ReactNode }) {
  return <ConfigProvider locale={zhCN} componentSize="small" theme={desktopTheme} button={{ autoInsertSpace: false }}>
    <App className="desktop-ant-app">{children}</App>
  </ConfigProvider>
}
