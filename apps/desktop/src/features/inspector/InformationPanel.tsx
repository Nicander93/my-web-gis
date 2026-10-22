import { Select } from 'antd'
import { useState } from 'react'
import { useProjectStore } from '@/stores/project.store'
import { Button } from '@/components/ui/Button'
import { layerCommands } from '@/app/commands/layer.commands'
import { useInformationStore } from '@/stores/information.store'

export function InformationPanel() {
  const epoch = useProjectStore(state => state.projectEpoch)
  const project = useProjectStore(state => state.project)
  const features = useProjectStore(state => state.featuresByDataset)
  const information = useInformationStore()
  const [selected, setSelected] = useState('')
  const results = information.epoch === epoch ? information.results.flatMap(result => {
    const layer = project.layers.find(item => item.id === result.layerId)
    const feature = layer && features[layer.datasetId]?.find(item => item.id === result.featureId)
    return layer && feature ? [{ layer, feature, key: `${layer.id}:${feature.id}` }] : []
  }) : []
  const current = results.find(item => item.key === selected) ?? results[0]
  if (!current) return <div className="workbench-empty"><strong>暂无识别结果</strong><p>使用顶部“识别”工具点击地图上的要素。</p></div>
  return <div className="feature-panel information-panel">
    <Select aria-label="识别结果" value={current.key} onChange={setSelected} options={results.map((item, index) => ({ value: item.key, label: `${item.layer.name} · 记录 ${index + 1}` }))} />
    <dl className="feature-properties">{Object.entries(current.feature.properties).map(([key, value]) => <div key={key}>
      <dt>{key}</dt><dd>{value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
    </div>)}</dl>
    <Button variant="ghost" onClick={() => layerCommands.openAttributeTable(current.layer.id)}>打开属性表</Button>
    <details><summary>记录信息</summary><code>{current.feature.id}</code></details>
  </div>
}
