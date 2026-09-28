import { Table2 } from 'lucide-react'
import { useProjectStore } from '@/stores/project.store'

export function AttributeTable() {
  const selectedLayerId = useProjectStore((state) => state.selectedLayerId)
  const project = useProjectStore((state) => state.project)
  const featuresByDataset = useProjectStore((state) => state.featuresByDataset)
  
  const selectedLayer = selectedLayerId 
    ? project.layers.find(l => l.id === selectedLayerId)
    : null
    
  const features = selectedLayer
    ? (featuresByDataset[selectedLayer.datasetId] ?? [])
    : []
  
  const fieldNames = features.length > 0
    ? Object.keys(features[0].properties)
    : []

  return (
    <div className="feature-panel attribute-table-content">
      <div className="table-summary">
        <div className="table-title">
          <Table2 size={15} />
          <strong>{selectedLayer?.name ?? '未选择图层'}</strong>
        </div>
        <span>{features.length} 条记录</span>
      </div>
      <div className="table-scroll">
        {selectedLayer && features.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>ID</th>
                {fieldNames.map(field => (
                  <th key={field}>{field}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {features.slice(0, 100).map((feature, index) => (
                <tr key={feature.id}>
                  <td>{index + 1}</td>
                  <td>{feature.id}</td>
                  {fieldNames.map(field => (
                    <td key={field}>
                      {feature.properties[field] != null 
                        ? String(feature.properties[field]) 
                        : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr><th>#</th><th>名称</th><th>类型</th><th>状态</th></tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={4} className="empty-table-cell">
                  {selectedLayer ? '该图层暂无属性数据' : '请选择一个图层'}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
