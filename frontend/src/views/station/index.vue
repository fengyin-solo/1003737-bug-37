<template>
  <section class="page" data-module="station">
    <header class="page-head">
      <div>
        <h2>监测站点管理</h2>
        <p class="page-desc">维护水文监测站，围绕站点编号、站点名称、站点类型、所在河流做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记水文监测站</button>
        <button class="btn" type="button" @click="exportRows">导出监测站点清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            {{ row.status }}
            <span v-if="faultsOf(row).length" class="tag danger">{{ faultsOf(row).length }} 条故障待处置</span>
          </td>
          <td class="row-actions">
            <template v-for="action in actions" :key="action">
              <button
                class="link"
                type="button"
                :disabled="!guardOf(row, action).allowed"
                :title="guardOf(row, action).reason"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <!-- 站点页同步处置该站巡检故障：归属、前置状态、幂等仍由数据层统一把关 -->
            <button
              v-for="fault in faultsOf(row)"
              :key="String(fault.id)"
              class="link"
              type="button"
              :disabled="!canDisposeFault(row, fault).allowed"
              :title="`${fault['记录编号']}：${canDisposeFault(row, fault).reason || '确认处置该巡检故障'}`"
              @click="disposeFault(row, fault)"
            >
              处置故障 {{ fault['记录编号'] }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无监测站点数据，可先登记水文监测站</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条监测站点记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <DetailDialog
      ref="dialogRef"
      :open="dialog.open"
      :title="`确认处置巡检故障 · ${dialog.fault?.['记录编号'] ?? ''}`"
      :detail="dialogDetail"
      mode="dispose"
      conclusion-label="处置结论"
      @cancel="closeDialog"
      @submit="submitDispose"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  disposeStationFault,
  evaluateAction,
  evaluateStationFault,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import DetailDialog from '@/components/DetailDialog.vue'
import type { ActionGuard } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('station')
const columns = meta.fields
const actions = meta.actions
const statuses = meta.statuses

const rows = ref<EntryRow[]>([])
const inspectionRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '站点总数', value: rows.value.length },
  { label: '正常运行数', value: rows.value.filter((row) => row.status === '正常运行' || row.status === '汛期加强').length },
  { label: '故障站点数', value: rows.value.filter((row) => row.status === '设备故障').length },
])

type DialogState = { open: boolean; station: EntryRow | null; fault: EntryRow | null }
const dialog = ref<DialogState>({ open: false, station: null, fault: null })
const dialogRef = ref<InstanceType<typeof DetailDialog> | null>(null)

// 设备关系：站点编号关联该站巡检记录，只把「发现故障」的待处置项暴露到设备页。
function faultsOf(station: EntryRow): EntryRow[] {
  const code = String(station['站点编号'] ?? '')
  return inspectionRows.value.filter(
    (row) => String(row['站点编号']) === code && row.status === '发现故障',
  )
}

function guardOf(row: EntryRow, action: string): ActionGuard {
  return evaluateAction(meta.key, row, action)
}

// 设备页处置入口的判定全部来自数据层：站点归属、记录归属、跨表一致性。
function canDisposeFault(station: EntryRow, fault: EntryRow): ActionGuard {
  return evaluateStationFault(station, fault)
}

const dialogDetail = computed(() => {
  const fault = dialog.value.fault
  const station = dialog.value.station
  if (!fault || !station) {
    return []
  }
  return [
    { label: '站点编号', value: station['站点编号'] },
    { label: '站点名称', value: station['站点名称'] },
    { label: '管理单位', value: station['管理单位'] },
    { label: '记录编号', value: fault['记录编号'] },
    { label: '巡检日期', value: fault['巡检日期'] },
    { label: '巡检人员', value: fault['巡检人员'] },
    { label: '发现问题', value: fault['发现问题'] },
    { label: '处理措施', value: fault['处理措施'] },
    { label: '当前状态', value: fault.status },
  ]
})

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '水文监测站登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function disposeFault(station: EntryRow, fault: EntryRow) {
  errorMessage.value = ''
  dialog.value = { open: true, station, fault }
}

function closeDialog() {
  dialog.value = { open: false, station: null, fault: null }
}

function submitDispose(conclusion: string) {
  const fault = dialog.value.fault
  const station = dialog.value.station
  if (!fault || !station) {
    return
  }
  // 设备页写入与巡检列表完全同源：越权拒绝、重复处置只生效一次、失败原样保留。
  const result = disposeStationFault(station, fault, { conclusion })
  if (!result.ok) {
    dialogRef.value?.showError(result.message)
    return
  }
  closeDialog()
  errorMessage.value = ''
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    inspectionRows.value = listEntries('inspection').items
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '监测站点列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.tag { font-size: 11px; border-radius: 999px; padding: 1px 8px; margin-left: 4px; }
.tag.danger { background: #fdecea; color: #b42318; }
.link:disabled { color: #9aa4b2; cursor: not-allowed; }
</style>
