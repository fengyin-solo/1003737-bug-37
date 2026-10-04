import { MODULE_BY_KEY } from './modules'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'
const MIGRATION_KEY = 'hydrology-monitor-storage:schema-version'
const CURRENT_SCHEMA_VERSION = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isPendingByMeta(moduleKey: string, status: string): boolean {
  const meta = MODULE_BY_KEY.get(moduleKey)
  if (!meta) {
    return false
  }
  if (meta.pendingStatuses) {
    return meta.pendingStatuses.includes(status)
  }
  return status !== meta.statuses[meta.statuses.length - 1]
}

// 站点编号 → 管理单位，供历史记录沿站点关系补归属。
function buildStationUnitMap(rows: Record<string, EntryRow[]>): Map<string, string> {
  const map = new Map<string, string>()
  for (const station of rows.station ?? []) {
    const code = String(station['站点编号'] ?? '').trim()
    const unit = String(station['管理单位'] ?? '').trim()
    if (code && unit) {
      map.set(code, unit)
    }
  }
  return map
}

// 旧数据迁移：
// 1. 给缺「归属单位」的巡检/设备记录沿站点关系补归属；
// 2. 归属补不出来的历史记录保持无归属——数据层按只读处理，动作一律拒绝；
// 3. 按模块新的待办定义重算 pending，修掉「待处置故障不在待办里」的旧错误；
// 4. 遥测设备历史上没有「归属单位」列，同样走站点推导。
function migrate(rows: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const stationUnits = buildStationUnitMap(rows)

  for (const [moduleKey, entries] of Object.entries(rows)) {
    const meta = MODULE_BY_KEY.get(moduleKey)
    if (!meta || !Array.isArray(entries)) {
      continue
    }
    for (const row of entries) {
      if (meta.ownership?.unitField) {
        const existing = String(row[meta.ownership.unitField] ?? '').trim()
        if (!existing && meta.ownership.stationField) {
          const code = String(row[meta.ownership.stationField] ?? '').trim()
          const viaStation = stationUnits.get(code)
          if (viaStation) {
            row[meta.ownership.unitField] = viaStation
          }
          // 查不到就不补：无显式归属且无站点关系的历史记录保持无主只读。
        }
      }
      row.pending = isPendingByMeta(moduleKey, String(row.status))
    }
  }
  return rows
}

function readSchemaVersion(): number {
  if (typeof window === 'undefined' || !window.localStorage) {
    return CURRENT_SCHEMA_VERSION
  }
  const raw = window.localStorage.getItem(MIGRATION_KEY)
  return raw ? Number(raw) || 0 : 0
}

function writeSchemaVersion(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(MIGRATION_KEY, String(CURRENT_SCHEMA_VERSION))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    writeSchemaVersion()
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    // 旧版本（无 schema 标记或版本号更低）的数据跑一次归属/待办迁移。
    const merged: Record<string, EntryRow[]> = { ...fallback, ...parsed }
    if (readSchemaVersion() < CURRENT_SCHEMA_VERSION) {
      migrate(merged)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
      writeSchemaVersion()
    }
    return merged
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    writeSchemaVersion()
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
