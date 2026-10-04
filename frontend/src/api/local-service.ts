import { useSessionStore } from '@/stores/session'
import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  DisposePayload,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 处置类动作携带结论时，写回记录的字段名。
const DISPOSE_ACTIONS: Record<string, { conclusionField: string; operatorField: string; dateField: string }> = {
  确认处置: { conclusionField: '处置结论', operatorField: '处置人', dateField: '处置日期' },
  确认修复: { conclusionField: '修复结论', operatorField: '修复人', dateField: '修复日期' },
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 站点编号 → 监测站点行，归属关系从站点的「管理单位」往各业务表推导。
function stationIndex(): Map<string, EntryRow> {
  const map = new Map<string, EntryRow>()
  for (const station of listRows('station')) {
    const code = String(station['站点编号'] ?? '').trim()
    if (code) {
      map.set(code, station)
    }
  }
  return map
}

// 归属解析结果：
// - unit 有值：该记录归属于某个管理单位
// - unit 为空：归属无法确定（历史无归属、站点也查不到），按只读策略处理
export type Ownership = { unit: string | null; source: 'field' | 'station' | 'none' }

export function resolveOwnership(key: string, row: EntryRow): Ownership {
  const meta = moduleMeta(key)
  const rule = meta.ownership
  if (!rule) {
    return { unit: null, source: 'none' }
  }

  if (rule.unitField) {
    const direct = String(row[rule.unitField] ?? '').trim()
    if (direct) {
      return { unit: direct, source: 'field' }
    }
  }

  if (rule.stationField) {
    const code = String(row[rule.stationField] ?? '').trim()
    const station = code ? stationIndex().get(code) : undefined
    const viaStation = station ? String(station['管理单位'] ?? '').trim() : ''
    if (viaStation) {
      return { unit: viaStation, source: 'station' }
    }
  }

  return { unit: null, source: 'none' }
}

// 前端按钮的可点状态也走这里，保证入口展示与数据层判定是同一套规则。
export type ActionGuard = { allowed: boolean; reason: string }

export function evaluateAction(key: string, row: EntryRow, action: string): ActionGuard {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { allowed: false, reason: `${meta.entity}没有登记「${action}」这个动作` }
  }

  const session = useSessionStore()
  if (!session.canOperate) {
    return { allowed: false, reason: '当前未登录或归属单位已退出，不能执行业务动作，请先登录' }
  }

  const current = String(row.status)

  // 归属拦截：巡检人员/设备的归属单位必须与当前值班单位一致。
  const rule = meta.ownership
  if (rule && !rule.publicActions?.includes(action)) {
    const owner = resolveOwnership(key, row)
    if (!owner.unit) {
      if (rule.readonlyWhenMissing) {
        return {
          allowed: false,
          reason: '该记录缺少归属单位且无法通过站点关系确定，按历史无主记录只读处理',
        }
      }
    } else if (owner.unit !== session.unit) {
      return {
        allowed: false,
        reason: `越权操作：该${meta.entity}归属「${owner.unit}」，当前值班单位为「${session.unit}」`,
      }
    }
  }

  // 幂等：已经在目标状态，重复动作只生效一次。
  if (current === target) {
    return { allowed: false, reason: `${meta.entity}已经是「${target}」，无需重复操作` }
  }

  // 前置状态：状态机不允许跳步（例如未报告故障不得确认处置）。
  const allowedFrom = meta.actionPreconditions?.[action]
  if (allowedFrom && !allowedFrom.includes(current)) {
    return {
      allowed: false,
      reason: `${meta.entity}当前为「${current}」，不满足「${action}」的前提状态（${allowedFrom.join(' / ')}）`,
    }
  }

  return { allowed: true, reason: '' }
}

function isPending(meta: ModuleMeta, status: string): boolean {
  if (meta.pendingStatuses) {
    return meta.pendingStatuses.includes(status)
  }
  return status !== meta.statuses[meta.statuses.length - 1]
}

// 设备页（站点页）处置该站巡检故障的专属判定：
// 除了巡检记录自身的登录/归属/前置状态/幂等要求，还强制
// 「站点.管理单位 == 当前值班单位 == 巡检记录归属」且记录确实挂在该站点下，
// 防止借设备页入口绕过归属关系。
export function evaluateStationFault(station: EntryRow, fault: EntryRow): ActionGuard {
  const session = useSessionStore()
  if (!session.canOperate) {
    return { allowed: false, reason: '当前未登录或归属单位已退出，不能执行业务动作，请先登录' }
  }
  const stationUnit = String(station['管理单位'] ?? '').trim()
  if (!stationUnit) {
    return { allowed: false, reason: '该水文监测站缺少管理单位，无法确认归属' }
  }
  if (stationUnit !== session.unit) {
    return {
      allowed: false,
      reason: `越权操作：该站点归属「${stationUnit}」，当前值班单位为「${session.unit}」`,
    }
  }
  const stationCode = String(station['站点编号'] ?? '').trim()
  if (String(fault['站点编号'] ?? '').trim() !== stationCode) {
    return { allowed: false, reason: '该巡检记录不属于当前站点，不能在此处置' }
  }
  const owner = resolveOwnership('inspection', fault)
  if (!owner.unit) {
    return { allowed: false, reason: '该巡检记录缺少归属单位且无法经站点关系确定，按历史无主记录只读处理' }
  }
  if (owner.unit !== stationUnit) {
    return { allowed: false, reason: '巡检记录归属与站点管理单位不一致，禁止跨单位处置' }
  }
  return evaluateAction('inspection', fault, '确认处置')
}

// 设备页提交入口：跨表归属一致性在这里收口，状态流转复用 runAction。
export function disposeStationFault(
  station: EntryRow,
  fault: EntryRow,
  payload?: DisposePayload,
): ActionResult {
  const guard = evaluateStationFault(station, fault)
  if (!guard.allowed) {
    return { ok: false, message: guard.reason }
  }
  return runAction('inspection', Number(fault.id), '确认处置', payload)
}

export function runAction(
  key: string,
  id: number,
  action: string,
  payload?: DisposePayload,
): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]

  // 先校验、后写入：任何一关不通过都原样返回，不触碰存储。
  const guard = evaluateAction(key, row, action)
  if (!guard.allowed) {
    return { ok: false, message: guard.reason }
  }

  const target = meta.actionTargets[action]
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: isPending(meta, target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }

  // 处置结论随动作一起原子落库；弹窗里填的草稿在确认前不写任何数据。
  const dispose = DISPOSE_ACTIONS[action]
  if (dispose) {
    const conclusion = (payload?.conclusion ?? '').trim()
    if (!conclusion) {
      // 结论缺失视为校验失败：保持原记录不变，不做半截写入。
      return { ok: false, message: `请填写${action}的结论后再提交` }
    }
    const session = useSessionStore()
    updated[dispose.conclusionField] = conclusion
    updated[dispose.operatorField] = session.operator
    updated[dispose.dateField] = new Date().toISOString().slice(0, 10)
  }

  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
