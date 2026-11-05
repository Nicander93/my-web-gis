import { useEffect, useState, type CSSProperties } from 'react'
import { Alert, Button, Form, Menu, Select, Slider } from 'antd'
import { ModelessWindow } from '@/ui/components/ModelessWindow'
import { MAX_UI_FONT_SIZE, MIN_UI_FONT_SIZE, usePreferencesStore } from '@/stores/preferences.store'
import packageInfo from '@/../package.json'
import './software-settings.css'

export function SoftwareSettings() {
  const preferences = usePreferencesStore()
  const [section, setSection] = useState('appearance')
  const [sliderScale, setSliderScale] = useState<number | null>(null)
  useEffect(() => {
    if (sliderScale === null) return
    const release = () => setSliderScale(null)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => { window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release) }
  }, [sliderScale])
  if (!preferences.settingsOpen) return null
  return <ModelessWindow title="软件设置" width={650} height={410} className="software-settings" freezeScale={sliderScale !== null} onClose={() => preferences.setSettingsOpen(false)}>
    <div className="software-settings__layout" style={sliderScale === null ? undefined : { '--ui-scale': sliderScale } as CSSProperties}>
      <Menu selectedKeys={[section]} onClick={({ key }) => setSection(key)} items={[{ key: 'appearance', label: '外观与界面' }, { key: 'about', label: '关于与更新' }]} />
      <div className="software-settings__content">
        {section === 'appearance' ? <>
          <h3>外观与界面</h3>
          <Form layout="horizontal" labelCol={{ flex: 'calc(85px * var(--ui-scale))' }} wrapperCol={{ flex: 'auto' }} colon={false}>
            <Form.Item label="主题"><Select virtual={false} aria-label="软件主题" value={preferences.theme} onChange={theme => preferences.update({ theme })} options={[{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }, { value: 'system', label: '跟随系统' }]} /></Form.Item>
            <Form.Item label="界面字号"><div className="software-settings__font-size" onPointerDownCapture={() => setSliderScale(preferences.fontSize / 12)}><Slider ariaLabelForHandle="界面字号" min={MIN_UI_FONT_SIZE} max={MAX_UI_FONT_SIZE} step={1} value={preferences.fontSize} onChange={fontSize => preferences.update({ fontSize })} /><output>{preferences.fontSize} px · {Math.round(preferences.fontSize / 12 * 100)}%</output></div></Form.Item>
            <Form.Item label="控件密度"><Select virtual={false} aria-label="控件密度" value={preferences.density} onChange={density => preferences.update({ density })} options={[{ value: 'compact', label: '紧凑' }, { value: 'standard', label: '标准' }]} /></Form.Item>
          </Form>
          <p>设置立即生效并保存在本机。地图符号与标注字号由图层样式控制。</p>
          <Button onClick={preferences.reset}>恢复默认外观</Button>
        </> : <>
          <h3>my-web-gis</h3>
          <dl><dt>应用版本</dt><dd>{packageInfo.version}</dd><dt>项目</dt><dd>二维地图与三维场景工作台</dd></dl>
          <Alert type="info" title="当前版本尚未接入自动更新服务。" />
          <Button disabled title="自动更新服务尚未接入">检查更新</Button>
        </>}
      </div>
    </div>
  </ModelessWindow>
}

