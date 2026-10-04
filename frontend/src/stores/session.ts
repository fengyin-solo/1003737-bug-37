import { defineStore } from 'pinia'

// 会话只保存在内存里：刷新页面会回到默认值班身份；点「退出」后 operator/unit 清空，
// 动作入口（local-service.runAction）会拒绝一切写操作，直到重新登录。
export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    unit: '城东分局',
    shiftLabel: '白班 08:00-20:00',
    scope: '水文监测站网管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0 && state.unit.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    signIn(operator: string, unit: string) {
      this.operator = operator
      this.unit = unit
    },
    signOut() {
      this.operator = ''
      this.unit = ''
    },
  },
})
