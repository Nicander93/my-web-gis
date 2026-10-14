import type { ReactNode } from 'react'
import { App, ConfigProvider, type ThemeConfig } from 'antd'
import zhCN from 'antd/locale/zh_CN'

/** Ant Design controls share the approved workbench palette and desktop density. */
const desktopTheme: ThemeConfig = {
  token: {
    colorPrimary: '#38745a', colorInfo: '#38745a', colorBgLayout: '#f7f9f6', colorBgContainer: '#ffffff',
    colorBorder: '#d3dfd5', colorBorderSecondary: '#ebefeb', colorText: '#26352d', colorTextSecondary: '#77877c', colorError: '#a64c47',
    colorBgMask: '#13251d29',
    colorInfoBg: '#f1f7f0', colorInfoBorder: '#d7e5d9',
    fontFamily: "'Segoe UI', 'Microsoft YaHei UI', system-ui, 'Noto Sans SC', sans-serif",
    fontSize: 12, borderRadius: 4, borderRadiusSM: 3, borderRadiusLG: 7,
    controlHeight: 30, controlHeightSM: 29, motion: false
  },
  components: {
    Button: { paddingInlineSM: 10, defaultColor: '#44624d', defaultShadow: 'none', primaryShadow: 'none' },
    Form: { itemMarginBottom: 14, verticalLabelPadding: '0 0 6px', labelColor: '#67786d' },
    Tabs: { horizontalItemPaddingSM: '5px 8px', cardHeightSM: 28 },
    Table: { headerBg: '#f8faf8', headerColor: '#596c5b', rowHoverBg: '#f1f7f0',
      rowSelectedBg: '#e6f0e5', rowSelectedHoverBg: '#dfeedd', borderColor: '#e4ebe5',
      cellFontSizeSM: 12, cellPaddingBlockSM: 6, cellPaddingInlineSM: 10 },
    Modal: { titleFontSize: 12, headerBg: '#fdfefc' }
  }
}

export function DesktopUiProvider({ children }: { children: ReactNode }) {
  return <ConfigProvider locale={zhCN} componentSize="small" theme={desktopTheme} button={{ autoInsertSpace: false }}>
    <App className="desktop-ant-app">{children}</App>
  </ConfigProvider>
}
