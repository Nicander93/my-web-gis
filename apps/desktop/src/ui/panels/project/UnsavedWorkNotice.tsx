import { useFeatureEditState } from '@/project/datasets/feature-data'
import { useProjectStore } from '@/project/project.store'

/** 打开、新建和关闭时用同样的措辞说明需要处理的修改。 */
export function UnsavedWorkNotice() {
  const dirty = useProjectStore(state => state.dirty)
  const { unsavedCount } = useFeatureEditState()
  if (!dirty && !unsavedCount) return null
  return <p className="editor-warning">
    {dirty && '项目配置有修改待保存。'}
    {unsavedCount > 0 && `还有 ${unsavedCount} 条数据修改待提交。`}
  </p>
}
