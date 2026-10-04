/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

// 归属解析：显式字段优先，缺省时沿站点编号去站点表的「管理单位」推导。
export type OwnershipSpec = {
  // 本行记录里直接写明归属单位的字段名（如巡检记录的「归属单位」）
  unitField?: string
  // 本行记录里指向监测站点的字段名，用于跨表推导归属（站点编号/所属站点）
  stationField?: string
  // 为 true 时，归属推导不出来的历史记录按只读处理，任何写动作一律拒绝
  readonlyWhenMissing?: boolean
  // 该模块内无需归属校验即可执行的动作（通常为登记类），缺省表示全部动作都要校验
  publicActions?: string[]
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  // 每个动作允许从哪些状态发起；缺省只拦截「已经是目标状态」的重复操作。
  // 配成数组后，当前状态不在其中即拒绝，从状态机层面挡住跳步/重复处置。
  actionPreconditions?: Record<string, string[]>
  // 落在这些状态上的记录仍算待办；缺省时退化为「非最后一个状态都算待办」。
  pendingStatuses?: string[]
  // 归属配置：缺省表示该模块不做单位归属拦截
  ownership?: OwnershipSpec
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

// 处置类动作携带的结论：只有全部校验通过后才随状态一起原子写入。
export type DisposePayload = {
  conclusion: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
