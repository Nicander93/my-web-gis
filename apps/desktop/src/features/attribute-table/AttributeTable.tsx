import { Table2 } from 'lucide-react'

/** Attribute Table 只负责表格内容，不知道自己位于底部面板。 */
export function AttributeTable() {
  return (
    <div className="feature-panel attribute-table-content">
      <div className="table-summary">
        <div className="table-title"><Table2 size={15} /><strong>道路中心线</strong></div>
        <span>0 条记录</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>#</th><th>名称</th><th>类型</th><th>状态</th></tr>
          </thead>
          <tbody>
            <tr><td colSpan={4} className="empty-table-cell">暂无属性数据</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
