<template>
  <section class="page" data-module="inspection">
    <header class="page-head">
      <div>
        <h2>巡检记录管理</h2>
        <p class="page-desc">维护巡检记录，围绕记录编号、站点编号、巡检日期、巡检人员做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡检记录</button>
        <button class="btn" type="button" @click="exportRows">导出巡检记录清单</button>
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
            <button class="link" type="button" @click="openDetail(row)">详情</button>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无巡检记录数据，可先登记巡检记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条巡检记录记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <DetailDialog
      ref="dialogRef"
      :open="dialog.open"
      :title="dialog.mode === 'dispose' ? `确认处置 · ${dialog.row?.['记录编号'] ?? ''}` : `巡检记录详情 · ${dialog.row?.['记录编号'] ?? ''}`"
      :detail="dialogDetail"
      :mode="dialog.mode"
      conclusion-label="处置结论"
      action-label="确认处置"
      :action-allowed="dialog.row ? guardOf(dialog.row, '确认处置').allowed : false"
      @cancel="closeDialog"
      @action="startDisposeFromDetail"
      @submit="submitDispose"
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

const meta = moduleMeta('inspection')
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

// 指标实时统计：「待处置故障」必须把「发现故障」态全部计入待办。
const stats = computed(() => [
  { label: '本月巡检次数', value: rows.value.length },
  { label: '已巡检站点', value: new Set(rows.value.filter((row) => row.status !== '待巡检').map((row) => String(row['站点编号']))).size },
  { label: '待处置故障', value: rows.value.filter((row) => row.pending && row.status === '发现故障').length },
])

type DialogState = { open: boolean; mode: 'view' | 'dispose'; row: EntryRow | null }
const dialog = ref<DialogState>({ open: false, mode: 'view', row: null })
const dialogRef = ref<InstanceType<typeof DetailDialog> | null>(null)

function ownershipOf(row: EntryRow) {
  return resolveOwnership(meta.key, row)
}

// 列表入口与数据层共用同一套判定：越权/未登录/跳步/重复处置直接置灰并给出原因。
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
      : '无归属且无法经站点推导，历史记录按只读处理',
  })
  for (const extra of ['处置结论', '处置人', '处置日期']) {
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
  errorMessage.value = '巡检记录登记入口尚未接入审批流'
}

function openDetail(row: EntryRow) {
  dialog.value = { open: true, mode: 'view', row }
}

// 详情页的处置入口：只允许从「发现故障」且归属本单位的记录进入，判定仍出自数据层。
function startDisposeFromDetail() {
  const row = dialog.value.row
  if (!row) {
    return
  }
  const guard = evaluateAction(meta.key, row, '确认处置')
  if (!guard.allowed) {
    errorMessage.value = guard.reason
    return
  }
  dialog.value = { open: true, mode: 'dispose', row }
}

function closeDialog() {
  dialog.value = { open: false, mode: 'view', row: null }
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  // 处置类动作先开弹窗收集结论；校验在数据层提交时再跑一遍，入口置灰不作为唯一防线。
  if (action === '确认处置') {
    dialog.value = { open: true, mode: 'dispose', row }
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function submitDispose(conclusion: string) {
  const row = dialog.value.row
  if (!row) {
    return
  }
  // 全部校验通过才原子写入；失败时记录原样保留，弹窗留着显示原因。
  const result = applyAction(meta.key, Number(row.id), '确认处置', { conclusion })
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
    errorMessage.value = error instanceof Error ? error.message : '巡检记录列表读取失败'
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
