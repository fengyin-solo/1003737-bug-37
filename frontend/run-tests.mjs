import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const testSource = `
import { createPinia, setActivePinia } from 'pinia'
import { useSessionStore } from '@/stores/session'
import { runAction, listEntries, resolveOwnership, evaluateAction, evaluateStationFault, disposeStationFault } from '@/api/local-service'
import { listRows } from '@/data/local-store'

setActivePinia(createPinia())
const session = useSessionStore()

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log('  PASS', name) }
  else { failed++; console.log('  FAIL', name, detail) }
}
function findRow(key, codeField, code) {
  return listRows(key).find((r) => String(r[codeField]) === code)
}

// 场景1：默认登录武汉单位，处置宜昌单位的故障 INSP-0003 -> 越权拒绝，记录原样
session.login('值班管理员', '武汉水文测报中心')
let fault = findRow('inspection', '记录编号', 'INSP-0003')
const before = JSON.stringify(fault)
let r = runAction('inspection', fault.id, '确认处置', { conclusion: '试试越权' })
check('跨单位确认处置被拒绝', r.ok === false && /越权/.test(r.message), r.message)
check('越权拒绝后记录保持原样', JSON.stringify(findRow('inspection', '记录编号', 'INSP-0003')) === before)
check('跨单位入口判定同样拒绝', evaluateAction('inspection', fault, '确认处置').allowed === false)
const waiting0 = findRow('inspection', '记录编号', 'INSP-0001')

// 场景1b：种子里「发现故障」必须全部计入待办（修复 pending 一刀切的旧错误）
const initialFaults = listRows('inspection').filter((x) => x.status === '发现故障')
check('发现故障记录全部为待办', initialFaults.length === 2 && initialFaults.every((x) => x.pending === true))

// 场景1c：处置发生前先验证退出登录拦截（退出后待办不能被处理，旧结论不残留）
session.logout()
check('退出后 canOperate=false', session.canOperate === false)
r = runAction('inspection', waiting0.id, '完成巡检')
check('退出后完成巡检被拒绝', r.ok === false && /未登录|退出/.test(r.message), r.message)
check('拒绝后记录仍为待巡检', findRow('inspection', '记录编号', 'INSP-0001').status === '待巡检')
check('退出后待处置故障仍在待办列表', listEntries('inspection').items.some((x) => x.status === '发现故障' && x.pending === true))
session.login('值班管理员', '武汉水文测报中心')

// 场景2：切换到宜昌单位，可处置本单位故障；无结论 -> 拒绝且不变；带结论 -> 成功且只生效一次
session.switchUnit('宜昌水文测报中心')
r = runAction('inspection', fault.id, '确认处置', { conclusion: '' })
check('处置结论为空被拒绝', r.ok === false && /结论/.test(r.message), r.message)
r = runAction('inspection', fault.id, '确认处置', { conclusion: '已更换卫星模块并复测正常' })
check('本单位确认处置成功', r.ok === true, r.message)
const disposed = findRow('inspection', '记录编号', 'INSP-0003')
check('处置后状态为已处置', disposed.status === '已处置')
check('处置结论/人/日期落库', String(disposed['处置结论']).includes('卫星模块') && disposed['处置人'] === '值班管理员' && !!disposed['处置日期'])
check('处置后退出待办(pending=false)', disposed.pending === false)
r = runAction('inspection', disposed.id, '确认处置', { conclusion: '再来一次' })
check('重复确认处置只生效一次', r.ok === false, r.message)

// 场景3：状态机跳步拦截 —— 待巡检记录不能直接确认处置
session.switchUnit('武汉水文测报中心')
const waiting = findRow('inspection', '记录编号', 'INSP-0001')
r = runAction('inspection', waiting.id, '确认处置', { conclusion: '跳步' })
check('未报告故障不得确认处置(前置状态拦截)', r.ok === false && /前提状态/.test(r.message), r.message)

// 场景3b：设备页（站点页）联动处置本站故障 —— 走独立的跨表归属判定
const whStation = findRow('station', '站点编号', 'STAT-0003')
const whStation1 = findRow('station', '站点编号', 'STAT-0001')
const whFault = findRow('inspection', '记录编号', 'INSP-0004')
const ycStation2 = findRow('station', '站点编号', 'STAT-0002')
const ycFault = findRow('inspection', '记录编号', 'INSP-0003') // 场景2已处置，用于验证重复只生效一次
let g2 = evaluateStationFault(whStation1, whFault)
check('设备页：同单位但非本站故障拒绝(记录不属于该站点)', g2.allowed === false && /不属于当前站点/.test(g2.reason), g2.reason)
// 注意 STAT-0002 此刻本身就是「设备故障」态，旧实现借用「登记故障」前置会误判，这里必须仍按站点归属放行/拒绝
session.switchUnit('宜昌水文测报中心')
g2 = evaluateStationFault(ycStation2, whFault)
check('设备页：宜昌账号在宜昌站点处置武汉站故障被拒', g2.allowed === false)
let rd = disposeStationFault(ycStation2, ycFault, { conclusion: '设备页再处置已处置故障' })
check('设备页：重复处置只生效一次', rd.ok === false, rd.message)
session.switchUnit('武汉水文测报中心')
g2 = evaluateStationFault(whStation, whFault)
check('设备页：本单位账号处置入口放行（不被站点自身状态误拦）', g2.allowed === true, g2.reason)
rd = disposeStationFault(whStation, whFault, { conclusion: '设备页联动处置：清理承雨口后复测正常' })
check('设备页联动处置成功', rd.ok === true, rd.message)
check('设备页处置后记录退出待办', findRow('inspection', '记录编号', 'INSP-0004').pending === false && findRow('inspection', '记录编号', 'INSP-0004').status === '已处置')
check('设备页处置结论落库', String(findRow('inspection', '记录编号', 'INSP-0004')['处置结论']).includes('复测'))

// 武汉的故障 INSP-0004 已在场景3b由设备页联动处置

// 场景5：遥测设备页同步写入核查 —— 武汉不能修复宜昌设备 TELE-0002
session.login('值班管理员', '武汉水文测报中心')
const dev = findRow('telemetry', '设备编号', 'TELE-0002')
r = runAction('telemetry', dev.id, '确认修复', { conclusion: '越权修设备' })
check('设备页跨单位确认修复被拒绝', r.ok === false && /越权/.test(r.message), r.message)
check('设备被拒后仍为待维修', findRow('telemetry', '设备编号', 'TELE-0002').status === '待维修')
session.switchUnit('宜昌水文测报中心')
r = runAction('telemetry', dev.id, '确认修复', { conclusion: '更换电源模块，信号恢复' })
check('本单位设备确认修复成功', r.ok === true, r.message)
check('修复后状态正常运行且退出待办', findRow('telemetry', '设备编号', 'TELE-0002').status === '正常运行' && findRow('telemetry', '设备编号', 'TELE-0002').pending === false)
r = runAction('telemetry', dev.id, '确认修复', { conclusion: '再修一次' })
check('重复修复只生效一次', r.ok === false)

// 场景6：归属沿站点关系推导（删掉显式归属单位的记录仍能从站点管理单位得出归属）
const derived = resolveOwnership('inspection', { id: 99, status: '发现故障', pending: true, abnormal: false, '站点编号': 'STAT-0002' })
check('缺显式归属时沿站点推导', derived.unit === '宜昌水文测报中心' && derived.source === 'station')
const orphan = resolveOwnership('inspection', { id: 100, status: '发现故障', pending: true, abnormal: false, '站点编号': 'STAT-9999' })
check('无站点关系的历史记录归属为空', orphan.unit === null && orphan.source === 'none')
r = (() => {
  session.switchUnit('武汉水文测报中心')
  return runAction('inspection', 99999, '确认处置') // 不存在记录
})()
check('记录不存在被拒绝', r.ok === false)

// 场景7：无主只读记录（归属无法确定）写动作一律拒绝
const guard = evaluateAction('inspection', { id: 100, status: '发现故障', pending: true, abnormal: false, '站点编号': 'STAT-9999' }, '确认处置')
check('历史无主记录只读拦截', guard.allowed === false && /只读/.test(guard.reason), guard.reason)

// 场景8：站点动作跨单位拦截（武汉不能撤销宜昌站点）
const ycStation = findRow('station', '站点编号', 'STAT-0002')
r = runAction('station', ycStation.id, '撤销站点')
check('跨单位站点写动作被拒绝', r.ok === false && /越权/.test(r.message), r.message)

console.log('')
console.log('RESULT passed=' + passed + ' failed=' + failed)
if (failed > 0) process.exit(1)
`

writeFileSync('/tmp/test-cases.ts', testSource)

await build({
  stdin: { contents: testSource, resolveDir: process.cwd(), sourcefile: 'test-cases.ts', loader: 'ts' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: '/tmp/test-bundle.mjs',
  logLevel: 'silent',
  plugins: [
    {
      name: 'at-alias',
      setup(b) {
        b.onResolve({ filter: /^@\// }, (args) => ({
          path: resolve('src', args.path.slice(2) + '.ts'),
        }))
      },
    },
  ],
})

await import('/tmp/test-bundle.mjs')
