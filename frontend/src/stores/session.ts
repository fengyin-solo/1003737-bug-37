import { defineStore } from 'pinia'

// 平台里的管理单位：站点、设备、巡检记录的归属都收敛到这一层。
export const MANAGE_UNITS = ['武汉水文测报中心', '宜昌水文测报中心'] as const
export type ManageUnit = (typeof MANAGE_UNITS)[number]

type SessionState = {
  operator: string
  // 当前登录人所属管理单位；未登录时为 null。
  unit: ManageUnit | null
  shiftLabel: string
  scope: string
}

export const useSessionStore = defineStore('session', {
  state: (): SessionState => ({
    operator: '值班管理员',
    unit: '武汉水文测报中心',
    shiftLabel: '白班 08:00-20:00',
    scope: '水文监测站网管理系统',
  }),
  getters: {
    // 只有登录且归属单位明确的人才能进入写动作。
    canOperate: (state) => state.operator.length > 0 && state.unit !== null,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    // 切换当前值班单位（同一账号在不同单位值班的场景）。
    switchUnit(unit: ManageUnit) {
      this.unit = unit
    },
    // 退出登录：清掉归属身份。退出后任何写动作都必须在数据层被拒绝。
    logout() {
      this.unit = null
      this.operator = ''
    },
    login(operator: string, unit: ManageUnit) {
      this.operator = operator
      this.unit = unit
    },
  },
})
