import { useEffect, useState } from 'react'
import { Alert, Button, Collapse, Descriptions, Empty, Select, Space, Table, Tag, Typography } from 'antd'
import { useTaskLogStore, canCancelTask, type TaskEntry, type TaskStatus } from '@/stores/task-log.store'
import { useProjectStore } from '@/stores/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { collectDiagnostics, type ResourceStates } from '@/services/diagnostics'
import './activity-panel.css'

const statuses: Record<TaskStatus, string> = { running: '处理中', succeeded: '已完成', failed: '失败', cancelled: '已取消' }
const colors: Record<TaskStatus, string> = { running: 'processing', succeeded: 'success', failed: 'error', cancelled: 'default' }
const resourceStates: Record<string, string> = { loading: '加载中', ready: '已就绪', error: '失败', unknown: '未检查' }

export function ActivityPanel({ tab, sceneStates, onSelectResource }: { tab: 'tasks' | 'diagnostics'; sceneStates?: ResourceStates; onSelectResource?(id: string): void }) {
  const epoch = useProjectStore(state => state.projectEpoch)
  const project = useProjectStore(state => state.project)
  const dirty = useProjectStore(state => state.dirty)
  const entries = useTaskLogStore(state => state.entries)
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string>()
  const [copyStatus, setCopyStatus] = useState('')
  const [report, setReport] = useState(() => collectDiagnostics(sceneStates))
  useEffect(() => { if (tab === 'diagnostics') setReport(collectDiagnostics(sceneStates)) }, [tab, project, dirty, sceneStates])
  useEffect(() => { setSelectedId(undefined); setCopyStatus('') }, [epoch, tab])
  const logs = entries.filter(entry => entry.projectEpoch === epoch).sort((a, b) => b.startedAt - a.startedAt)
  const rows = logs.filter(entry => filter === 'all' || entry.status === filter)
  const selected = logs.find(entry => entry.id === selectedId)
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopyStatus('已复制') }
    catch { setCopyStatus('复制失败，请选中文字后复制') }
  }
  function selectResource(id: string) {
    if (onSelectResource) onSelectResource(id)
    else { useProjectStore.getState().setSelectedLayer(id); useWorkbenchStore.getState().bindInspector(id); useWorkspaceStore.getState().setRightOpen(true) }
  }
  return <div className="activity-panel">
    {tab === 'tasks' ? <>
      <Space className="activity-panel__toolbar"><Select aria-label="任务状态筛选" virtual={false} value={filter} onChange={value => { setFilter(value); setSelectedId(undefined); setCopyStatus('') }} style={{ width: 130 }} options={[{ value: 'all', label: '全部状态' }, ...Object.entries(statuses).map(([value, label]) => ({ value, label }))]} />
        <Button onClick={() => { useTaskLogStore.getState().clear(epoch); setSelectedId(undefined) }}>清空已结束记录</Button><Typography.Text type="secondary">仅记录当前工程会话，保留最近 200 条已结束记录</Typography.Text></Space>
      <Table<TaskEntry> size="small" rowKey="id" dataSource={rows} pagination={{ pageSize: 10, hideOnSinglePage: true }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务记录" /> }}
        onRow={entry => ({ onClick: () => { setSelectedId(entry.id); setCopyStatus('') } })} columns={[
          { title: '时间', dataIndex: 'startedAt', width: 110, render: value => new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) },
          { title: '任务', dataIndex: 'title', render: (title, entry) => <Button type="link" size="small" onClick={() => setSelectedId(entry.id)}>{title}</Button> },
          { title: '状态', dataIndex: 'status', width: 90, render: (status: TaskStatus) => <Tag color={colors[status]}>{statuses[status]}</Tag> },
          { title: '结果', dataIndex: 'detail', ellipsis: true },
          { title: '操作', width: 90, render: (_, entry) => entry.status === 'running' && canCancelTask(entry.id) ? <Button size="small" onClick={event => { event.stopPropagation(); useTaskLogStore.getState().cancel(entry.id) }}>取消任务</Button> : null }
        ]} />
      {selected && <section className="activity-panel__detail" aria-label="任务详情"><Space><strong>{selected.title}</strong><Tag color={colors[selected.status]}>{statuses[selected.status]}</Tag><Button size="small" onClick={() => void copy(`${selected.title}\n${statuses[selected.status]}\n${selected.detail}`)}>复制任务详情</Button></Space><pre>{selected.detail || '任务正在执行…'}</pre></section>}
    </> : <>
      <Space className="activity-panel__toolbar"><Button onClick={() => { setReport(collectDiagnostics(sceneStates)); setCopyStatus('') }}>刷新诊断</Button><Button onClick={() => void copy(JSON.stringify(report, null, 2))}>复制诊断信息</Button><Typography.Text type="secondary">采集于 {new Date(report.collectedAt).toLocaleTimeString()}</Typography.Text></Space>
      {report.resources.some(resource => resource.state === 'error') && <Alert type="error" title="存在加载失败的资源，可点击对象查看数据源并重试。" />}
      <Descriptions size="small" title="项目" column={2} items={Object.entries({ 名称: report.project.name, 文件位置: report.project.path, 保存状态: report.project.saveState, '图层 / 对象': report.project.layers, 二维要素数: report.project.features }).map(([label, children]) => ({ key: label, label, children }))} />
      <Table size="small" rowKey="id" dataSource={[...report.resources].sort((a, b) => Number(b.state === 'error') - Number(a.state === 'error'))} pagination={{ pageSize: 5, hideOnSinglePage: true }} locale={{ emptyText: '暂无资源' }} columns={[
        { title: '资源', dataIndex: 'name', render: (name, row) => <Button type="link" size="small" onClick={() => selectResource(row.id)}>{name}</Button> },
        { title: '状态', dataIndex: 'state', width: 90, render: state => <Tag color={state === 'error' ? 'error' : state === 'ready' ? 'success' : 'default'}>{resourceStates[state]}</Tag> },
        { title: '来源', dataIndex: 'source', ellipsis: true }, { title: '详情', dataIndex: 'error' }
      ]} />
      <Collapse size="small" items={[{ key: 'environment', label: '运行环境', children: <Descriptions size="small" column={1} items={Object.entries({ 应用版本: report.environment.version, 运行方式: report.environment.host, 引擎: report.environment.engine, 运行状态: report.environment.running ? '已运行' : '未运行', 图形渲染: report.environment.renderer,
        ...(report.environment.runtime ? { 运行图层: report.environment.runtime.managedLayers, 标绘对象: report.environment.runtime.graphicObjects, 数据源: report.environment.runtime.dataSources, 图元: report.environment.runtime.primitives } : {})
      }).map(([label, children]) => ({ key: label, label, children }))} /> }]} />
    </>}
    <span role="status">{copyStatus}</span>
  </div>
}
