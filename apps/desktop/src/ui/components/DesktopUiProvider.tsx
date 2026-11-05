import { useLayoutEffect, useState, type ReactNode } from 'react'
import { App, ConfigProvider, theme, type ThemeConfig } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { usePreferencesStore } from '@/stores/preferences.store'

/** 以 tokens.css 为准；Ant Design 使用当前生效的语义色板。 */
function readTheme(): ThemeConfig {
  const root = document.documentElement, css = getComputedStyle(root)
  const value = (name: string) => css.getPropertyValue(name).trim()
  const dark = root.dataset.theme === 'dark' || root.dataset.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches
  const fontSize = Number.parseInt(value('--font-size-ui')) || 12
  const rowHeight = Number.parseInt(value('--desktop-row-height')) || 28
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: value('--color-accent'), colorInfo: value('--color-accent'),
      colorBgLayout: value('--color-app-bg'), colorBgContainer: value('--color-surface'),
      colorBorder: value('--color-border'), colorBorderSecondary: value('--color-border-subtle'),
      colorText: value('--color-text-primary'), colorTextSecondary: value('--color-text-secondary'),
      colorError: value('--color-danger'), colorBgElevated: value('--color-surface'),
      fontFamily: value('--font-ui'), fontSize, borderRadius: 4, borderRadiusSM: 3, borderRadiusLG: 7,
      controlHeight: Number.parseInt(value('--control-height')), controlHeightSM: Number.parseInt(value('--control-height')), motion: false
    },
    components: {
      Button: { paddingInlineSM: 10, defaultShadow: 'none', primaryShadow: 'none' },
      Form: { itemMarginBottom: 8, verticalLabelPadding: '0 0 4px' },
      Tabs: { horizontalItemPaddingSM: '4px 10px', cardHeightSM: Number.parseInt(value('--tab-height')) || 30 },
      Table: { headerBg: value('--color-panel'), rowHoverBg: value('--color-hover'), rowSelectedBg: value('--color-selected'), rowSelectedHoverBg: value('--color-active'), cellFontSizeSM: fontSize, cellPaddingBlockSM: Math.max(2, (rowHeight - 20) / 2), cellPaddingInlineSM: 8 },
      Modal: { titleFontSize: 13, headerBg: value('--color-panel') }
    }
  }
}

export function DesktopUiProvider({ children }: { children: ReactNode }) {
  const selectedTheme = usePreferencesStore(state => state.theme)
  const density = usePreferencesStore(state => state.density)
  const fontSize = usePreferencesStore(state => state.fontSize)
  const [config, setConfig] = useState(readTheme)
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = selectedTheme
    root.dataset.density = density
    const scale = fontSize / 12
    const standard = density === 'standard' ? 2 : 0
    root.style.setProperty('--ui-scale', String(scale))
    const dimensions: Record<string, number> = {
      '--font-size-ui': fontSize,
      '--control-height': Math.max(20, Math.round((26 + standard) * scale)),
      '--control-icon-height': Math.max(18, Math.round((24 + standard) * scale)),
      '--desktop-row-height': Math.max(20, Math.round((26 + standard) * scale)),
      '--tab-height': Math.max(21, Math.round((28 + standard) * scale)),
      '--ribbon-tool-height': Math.max(20, Math.round((26 + standard) * scale)),
      '--menu-height': Math.max(24, Math.round((32 + standard) * scale)),
      '--status-height': Math.max(18, Math.round((22 + standard) * scale)),
      '--toolrail-width': Math.max(26, Math.round(34 * scale)),
      '--space-group': Math.max(4, Math.round((8 + standard) * scale)),
      '--space-field': Math.max(3, Math.round((6 + standard) * scale)),
      '--icon-size': Math.max(10, Math.round(15 * scale))
    }
    for (const [name, value] of Object.entries(dimensions)) root.style.setProperty(name, `${value}px`)
    setConfig(readTheme())
  }, [selectedTheme, density, fontSize])
  useLayoutEffect(() => {
    const update = () => setConfig(readTheme())
    const observer = new MutationObserver(update), media = matchMedia('(prefers-color-scheme: dark)')
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-density'] })
    media.addEventListener('change', update)
    update()
    return () => { observer.disconnect(); media.removeEventListener('change', update) }
  }, [])
  return <ConfigProvider locale={zhCN} componentSize="small" theme={config} button={{ autoInsertSpace: false }}>
    <App className="desktop-ant-app">{children}</App>
  </ConfigProvider>
}
