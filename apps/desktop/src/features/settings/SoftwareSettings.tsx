import { useState } from 'react'
import { Alert, Button, Form, Menu, Select } from 'antd'
import { ModelessWindow } from '@/components/ui/ModelessWindow'
import { usePreferencesStore } from '@/stores/preferences.store'
import packageInfo from '../../../package.json'
import './software-settings.css'

export function SoftwareSettings() {
  const preferences = usePreferencesStore()
  const [section, setSection] = useState('appearance')
  if (!preferences.settingsOpen) return null
  return <ModelessWindow title="软件设置" width={650} height={410} className="software-settings" onClose={() => preferences.setSettingsOpen(false)}>
    <div className="software-settings__layout">
      <Menu selectedKeys={[section]} onClick={({ key }) => setSection(key)} items={[{ key: 'appearance', label: '外观与界面' }, { key: 'about', label: '关于与更新' }]} />
      <div className="software-settings__content">
        {section === 'appearance' ? <>
          <h3>外观与界面</h3>
          <Form layout="horizontal" labelCol={{ flex: '85px' }} wrapperCol={{ flex: 'auto' }} colon={false}>
            <Form.Item label="主题"><Select virtual={false} aria-label="软件主题" value={preferences.theme} onChange={theme => preferences.update({ theme })} options={[{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }, { value: 'system', label: '跟随系统' }]} /></Form.Item>
            <Form.Item label="界面字号"><Select virtual={false} aria-label="界面字号" value={preferences.fontSize} onChange={fontSize => preferences.update({ fontSize })} options={([11, 12, 13, 14] as const).map(value => ({ value, label: `${value} px` }))} /></Form.Item>
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

