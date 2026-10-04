<template>
  <section class="page" data-module="telemetry">
    <header class="page-head">
      <div>
        <h2>遥测设备管理</h2>
        <p class="page-desc">维护遥测设备，围绕设备编号、设备类型、所属站点、通讯方式做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记遥测设备</button>
        <button class="btn" type="button" @click="exportRows">导出遥测设备清单</button>
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
            <span v-if="ownershipOf(row).source === 'station'" class="tag muted">归属随站点</span>
            <span v-else-if="!ownershipOf(row).unit" class="tag danger">无主只读</span>
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
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无遥测设备数据，可先登记遥测设备</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条遥测设备记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <DetailDialog
      ref="dialogRef"
      :open="dialog.open"
      :title="`确认修复 · ${dialog.row?.['设备编号'] ?? ''}`"
      :detail="dialogDetail"
      mode="dispose"
      conclusion-label="修复结论"
      @cancel="closeDialog"
      @submit="submitRepair"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  evaluateAction,
  listEntries,
  moduleMeta,
  resolveOwnership,
  runAction as applyAction,
} from '@/api/local-service'
import DetailDialog from '@/components/DetailDialog.vue'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('telemetry')
const columns = meta.fields
const actions = meta.actions
const statuses = meta.statuses

const rows = ref<EntryRow[]>([])
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
  { label: '设备总数', value: rows.value.length },
  { label: '正常运行数', value: rows.value.filter((row) => row.status === '正常运行').length },
  { label: '待维修数', value: rows.value.filter((row) => row.pending).length },
])

const dialog = ref<{ open: boolean; row: EntryRow | null }>({ open: false, row: null })
const dialogRef = ref<InstanceType<typeof DetailDialog> | null>(null)

function ownershipOf(row: EntryRow) {
  return resolveOwnership(meta.key, row)
}

// 与巡检页同一套数据层判定：归属显式字段优先，缺失时沿所属站点推导，无主只读。
function guardOf(row: EntryRow, action: string) {
  return evaluateAction(meta.key, row, action)
}

const dialogDetail = computed(() => {
  const row = dialog.value.row
  if (!row) {
    return []
  }
  const owner = resolveOwnership(meta.key, row)
  const items = columns.map((field) => ({ label: field, value: row[field] ?? '' }))
  items.push({ label: '当前状态', value: row.status })
  items.push({
    label: '归属判定',
    value: owner.unit
      ? `${owner.unit}${owner.source === 'station' ? '（由站点管理单位推导）' : ''}`
      : '无归属且无法经站点推导，历史设备按只读处理',
  })
  for (const extra of ['修复结论', '修复人', '修复日期']) {
    if (row[extra] !== undefined) {
      items.push({ label: extra, value: row[extra] })
    }
  }
  return items
})

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '遥测设备登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '确认修复') {
    dialog.value = { open: true, row }
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function closeDialog() {
  dialog.value = { open: false, row: null }
}

function submitRepair(conclusion: string) {
  const row = dialog.value.row
  if (!row) {
    return
  }
  // 同步写入核查：归属/前置状态/幂等全部在数据层复核，失败保持设备原状。
  const result = applyAction(meta.key, Number(row.id), '确认修复', { conclusion })
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
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '遥测设备列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.tag { font-size: 11px; border-radius: 999px; padding: 1px 8px; margin-left: 4px; }
.tag.muted { background: #eef2f7; color: var(--muted); }
.tag.danger { background: #fdecea; color: #b42318; }
.link:disabled { color: #9aa4b2; cursor: not-allowed; }
</style>
