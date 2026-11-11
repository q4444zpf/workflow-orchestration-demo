<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Search, Refresh, ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import { workflowApi } from '../api'
import type { WorkflowSummary } from '../types'
import ManagementShell from '../components/ManagementShell.vue'
import WorkflowCard from '../components/WorkflowCard.vue'
const workflows = ref<WorkflowSummary[]>([])
const loading = ref(true)
const error = ref('')
const search = ref('')
const publication = ref('all')
const page = ref(1)
const pageSize = 8
const filtered = computed(() => workflows.value.filter(workflow => workflow.name.toLowerCase().includes(search.value.trim().toLowerCase())
  && (publication.value === 'all' || Boolean(workflow.is_published) === (publication.value === 'published'))))
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)))
const visible = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))
watch([search, publication], () => { page.value = 1 })
watch(pageCount, maximum => { page.value = Math.min(page.value, maximum) })
let generation = 0
let disposed = false
async function load() {
  const current = ++generation
  loading.value = true; error.value = ''
  try { const result = await workflowApi.list(); if (!disposed && current === generation) workflows.value = result }
  catch { if (!disposed && current === generation) error.value = '加载工作流列表失败，请重试' }
  finally { if (!disposed && current === generation) loading.value = false }
}
onMounted(load)
onBeforeUnmount(() => { disposed = true; generation++ })
</script>

<template>
  <ManagementShell active="workflows">
    <main class="management-page workflow-library">
      <header class="library-heading"><div><h1>工作流列表</h1><p>{{ workflows.length }} 个工作流</p></div><router-link class="primary-action" to="/editor">新建工作流</router-link></header>
      <div class="library-toolbar"><label class="library-search"><Search aria-hidden="true" /><input v-model="search" aria-label="搜索工作流" placeholder="搜索工作流名称" /></label><div class="publication-filter" role="group" aria-label="发布状态筛选"><span>发布状态：</span><div class="publication-options"><button aria-label="筛选全部工作流" :aria-pressed="publication === 'all'" @click="publication = 'all'">全部</button><button aria-label="筛选草稿工作流" :aria-pressed="publication === 'draft'" @click="publication = 'draft'">草稿</button><button aria-label="筛选已发布工作流" :aria-pressed="publication === 'published'" @click="publication = 'published'">已发布</button></div></div><button class="library-refresh secondary-action" aria-label="刷新工作流列表" :disabled="loading" @click="load"><Refresh aria-hidden="true" /></button></div>
      <p v-if="error" role="alert" class="error-notice">{{ error }}</p>
      <p v-else-if="loading" class="empty-state" role="status">正在加载工作流…</p>
      <template v-else><div class="workflow-grid" aria-label="工作流卡片列表"><WorkflowCard v-for="workflow in visible" :key="workflow.id" :workflow="workflow" /></div><div v-if="!filtered.length" class="library-empty"><p>{{ search || publication !== 'all' ? '没有匹配的工作流' : '暂无工作流，点击“新建工作流”开始' }}</p><button v-if="search || publication !== 'all'" class="secondary-action" @click="search = ''; publication = 'all'">清除筛选</button></div></template>
      <footer v-if="!loading && !error && filtered.length" class="library-pagination"><span>共 {{ filtered.length }} 个工作流</span><nav aria-label="工作流分页"><button aria-label="上一页工作流" :disabled="page <= 1" @click="page--"><ArrowLeft aria-hidden="true" /></button><button v-for="number in pageCount" :key="number" :aria-label="`第 ${number} 页工作流`" :aria-current="page === number ? 'page' : undefined" @click="page = number">{{ number }}</button><button aria-label="下一页工作流" :disabled="page >= pageCount" @click="page++"><ArrowRight aria-hidden="true" /></button></nav></footer>
    </main>
  </ManagementShell>
</template>

<style scoped>
.library-heading { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 24px; }
.library-heading h1 { margin: 0; font-size: 32px; line-height: 1.3; letter-spacing: -.6px; }
.library-heading p { margin: 10px 0 0; color: #5b6880; font-size: 14px; }
.library-heading .primary-action { min-height: 42px; padding: 10px 24px; }
.library-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 24px; padding: 18px 14px; margin-bottom: 28px; border: 1px solid #e0e7f1; border-radius: 9px; background: #f8faff; }
.library-search { display: flex; align-items: center; gap: 10px; min-width: 180px; width: 290px; padding: 9px 12px; background: white; border: 1px solid #d4ddec; border-radius: 6px; }
.library-search svg { width: 19px; height: 19px; color: #6e7e95; flex-shrink: 0; }
.library-search input { width: 100%; min-width: 0; padding: 0; border: 0; background: transparent; outline: none; color: #344056; font-size: 14px; }
.library-search:focus-within { outline: 2px solid #1677ff; outline-offset: 2px; }
.publication-filter { display: flex; align-items: center; gap: 10px; padding-left: 24px; border-left: 1px solid #dbe3ef; color: #44526a; font-size: 14px; }
.publication-options { display: flex; }
.publication-options button { padding: 9px 16px; border: 1px solid #d5deeb; background: #fff; color: #44526a; font-size: 14px; }
.publication-options button:first-child { border-radius: 5px 0 0 5px; } .publication-options button:last-child { border-radius: 0 5px 5px 0; }
.publication-options button + button { margin-left: -1px; }
.publication-options button[aria-pressed="true"] { position: relative; background: #1677ff; color: #fff; border-color: #1677ff; }
.library-refresh { margin-left: auto; padding: 8px; width: 40px; height: 40px; }
.library-refresh svg { width: 21px; height: 21px; }
.workflow-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 24px 14px; }
.library-empty { text-align: center; padding: 64px 20px; color: #64748b; }
.library-pagination { display: flex; justify-content: flex-end; align-items: center; gap: 24px; margin-top: 30px; color: #526079; font-size: 14px; }
.library-pagination nav { display: flex; flex-wrap: wrap; gap: 8px; }
.library-pagination button { min-width: 36px; height: 36px; padding: 6px 10px; border: 1px solid #d6deeb; border-radius: 6px; background: #fff; color: #344056; }
.library-pagination button svg { width: 16px; height: 16px; }
.library-pagination button[aria-current="page"] { background: #1677ff; border-color: #1677ff; color: #fff; }
.library-pagination button:disabled { opacity: .45; cursor: default; }
@media(max-width: 1200px) { .workflow-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } .library-toolbar { gap: 16px; } .publication-filter { border: 0; padding-left: 0; } }
@media(max-width: 1000px) { .workflow-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media(max-width: 550px) { .workflow-grid { grid-template-columns: 1fr; } .library-heading h1 { font-size: 26px; } .library-heading .primary-action { padding-inline: 12px; } .library-search { flex: 1; } .publication-filter { order: 2; flex-basis: 100%; } .library-pagination { justify-content: space-between; flex-wrap: wrap; } }
</style>
