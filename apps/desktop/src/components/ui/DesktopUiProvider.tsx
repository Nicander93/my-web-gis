import { useLayoutEffect, useState, type ReactNode } from 'react'
import { App, ConfigProvider, theme, type ThemeConfig } from 'antd'
import zhCN from 'antd/locale/zh_CN'

/** tokens.css is authoritative; Ant Design consumes the active semantic palette. */
function readTheme(): ThemeConfig {
  const root = document.documentElement, css = getComputedStyle(root)
  const value = (name: string) => css.getPropertyValue(name).trim()
  const dark = root.dataset.theme === 'dark' || root.dataset.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: value('--color-accent'), colorInfo: value('--color-accent'),
      colorBgLayout: value('--color-app-bg'), colorBgContainer: value('--color-surface'),
      colorBorder: value('--color-border'), colorBorderSecondary: value('--color-border-subtle'),
      colorText: value('--color-text-primary'), colorTextSecondary: value('--color-text-secondary'),
      colorError: value('--color-danger'), colorBgElevated: value('--color-surface'),
      fontFamily: value('--font-ui'), fontSize: 12, borderRadius: 4, borderRadiusSM: 3, borderRadiusLG: 7,
      controlHeight: Number.parseInt(value('--control-height')), controlHeightSM: Number.parseInt(value('--control-height')), motion: false
    },
    components: {
      Button: { paddingInlineSM: 10, defaultShadow: 'none', primaryShadow: 'none' },
      Form: { itemMarginBottom: 14, verticalLabelPadding: '0 0 6px' },
      Tabs: { horizontalItemPaddingSM: '5px 10px', cardHeightSM: 32 },
      Table: { headerBg: value('--color-panel'), rowHoverBg: value('--color-hover'), rowSelectedBg: value('--color-selected'), rowSelectedHoverBg: value('--color-active'), cellFontSizeSM: 12, cellPaddingBlockSM: 5, cellPaddingInlineSM: 10 },
      Modal: { titleFontSize: 13, headerBg: value('--color-panel') }
    }
  }
}

export function DesktopUiProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState(readTheme)
  useLayoutEffect(() => {
    const update = () => setConfig(readTheme())
    const observer = new MutationObserver(update), media = matchMedia('(prefers-color-scheme: dark)')
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    media.addEventListener('change', update)
    update()
    return () => { observer.disconnect(); media.removeEventListener('change', update) }
  }, [])
  return <ConfigProvider locale={zhCN} componentSize="small" theme={config} button={{ autoInsertSpace: false }}>
    <App className="desktop-ant-app">{children}</App>
  </ConfigProvider>
}
