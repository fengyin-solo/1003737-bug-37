<template>
  <div v-if="open" class="modal-mask" @click.self="cancel">
    <div class="modal-card" role="dialog" aria-modal="true">
      <header class="modal-head">
        <h3>{{ title }}</h3>
        <button class="link" type="button" @click="cancel">关闭</button>
      </header>

      <dl v-if="detail.length" class="detail-list">
        <div v-for="item in detail" :key="item.label" class="detail-row">
          <dt>{{ item.label }}</dt>
          <dd>{{ item.value || '—' }}</dd>
        </div>
      </dl>

      <div v-if="mode === 'dispose'" class="modal-body">
        <label class="filter-item">
          <span>{{ conclusionLabel }}<em class="required">*</em></span>
          <textarea
            v-model="draft"
            rows="3"
            :placeholder="`请填写${conclusionLabel}，提交后只允许本单位人员操作且不可重复处置`"
          ></textarea>
        </label>
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
      </div>

      <footer class="modal-foot">
        <button class="btn ghost" type="button" @click="cancel">取消</button>
        <button
          v-if="mode === 'view' && actionLabel && actionAllowed"
          class="btn primary"
          type="button"
          @click="emit('action')"
        >
          {{ actionLabel }}
        </button>
        <button v-if="mode === 'dispose'" class="btn primary" type="button" @click="submit">
          确认提交
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

export type DetailItem = { label: string; value: string | number | boolean }

const props = defineProps<{
  open: boolean
  title: string
  detail: DetailItem[]
  mode?: 'view' | 'dispose'
  conclusionLabel?: string
  // 只读详情里允许发起的动作（如「确认处置」）；不允许时由父组件传 false 隐藏入口。
  actionLabel?: string
  actionAllowed?: boolean
}>()

const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'action'): void
  // 结论由父组件带进修好的数据层动作；弹窗自身不落任何数据。
  (e: 'submit', conclusion: string): void
}>()

// 草稿只活在弹窗内存里：取消、退出登录或关闭都直接丢弃，不会残留旧结论。
const draft = ref('')
const errorMessage = ref('')

watch(
  () => props.open,
  (open) => {
    if (open) {
      draft.value = ''
      errorMessage.value = ''
    }
  },
)

function cancel() {
  draft.value = ''
  errorMessage.value = ''
  emit('cancel')
}

function submit() {
  if (!draft.value.trim()) {
    errorMessage.value = `请先填写${props.conclusionLabel ?? '处置结论'}`
    return
  }
  emit('submit', draft.value.trim())
}

// 父组件拿到数据层失败结果后回填错误信息，弹窗保持打开且不清空输入。
function showError(message: string) {
  errorMessage.value = message
}
defineExpose({ showError })
</script>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal-card {
  background: #fff;
  border-radius: 10px;
  width: 560px;
  max-width: calc(100vw - 32px);
  max-height: 82vh;
  overflow: auto;
  padding: 16px 18px;
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.modal-head h3 { margin: 0; font-size: 16px; }
.detail-list { margin: 0 0 8px; }
.detail-row {
  display: flex;
  gap: 12px;
  border-bottom: 1px dashed var(--border);
  padding: 6px 0;
  font-size: 13px;
}
.detail-row dt { width: 96px; color: var(--muted); flex: none; }
.detail-row dd { margin: 0; }
.modal-body textarea { width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 8px; font: inherit; resize: vertical; }
.required { color: #b42318; font-style: normal; margin-left: 2px; }
.modal-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
</style>
