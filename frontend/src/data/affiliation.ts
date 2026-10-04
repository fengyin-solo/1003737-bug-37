import { listRows } from './local-store'
import type { EntryRow } from './types'

// 归属管控范围：巡检记录 + 两个设备页（遥测设备、通讯设备）。
// 这些模块的记录本身不带管理单位，归属要顺着「记录 → 站点 → 管理单位」的链路解析；
// 其余模块的站点编号尚未与监测站点对齐，暂不纳入管控，避免误拦。
export const OWNED_MODULES = ['inspection', 'telemetry', 'communication']

// 记录上可能指向站点的字段，按优先级取第一个非空值。
const STATION_LINK_FIELDS = ['所属站点', '站点编号']

/**
 * 顺着归属链路解析记录的管理单位：
 *   巡检记录.站点编号 ─┐
 *   设备.所属站点     ─┴→ 监测站点.站点编号/站点名称 → 监测站点.管理单位
 * 返回 null 表示历史无归属记录（链路断在任何一环都算）。
 */
export function resolveAffiliation(row: EntryRow): string | null {
  const direct = String(row['管理单位'] ?? '').trim()
  if (direct) {
    return direct
  }
  let stationCode = ''
  for (const field of STATION_LINK_FIELDS) {
    const value = String(row[field] ?? '').trim()
    if (value) {
      stationCode = value
      break
    }
  }
  if (!stationCode) {
    return null
  }
  const station = listRows('station').find(
    (item) =>
      String(item['站点编号'] ?? '').trim() === stationCode ||
      String(item['站点名称'] ?? '').trim() === stationCode,
  )
  if (!station) {
    return null
  }
  const unit = String(station['管理单位'] ?? '').trim()
  return unit || null
}
