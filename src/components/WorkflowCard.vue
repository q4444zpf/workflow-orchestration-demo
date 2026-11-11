<script setup lang="ts">
import { computed } from 'vue'
import { Share, Refresh, CopyDocument, Connection, User, Document, VideoPlay } from '@element-plus/icons-vue'
import type { WorkflowSummary } from '../types'
import { formatTime } from './executionFormatting'
const props = defineProps<{ workflow: WorkflowSummary }>()
const icon = computed(() => {
  const name = props.workflow.name
  if (/循环/.test(name)) return Refresh
  if (/分支/.test(name)) return Share
  if (/并行/.test(name)) return CopyDocument
  if (/HTTP|接口/i.test(name)) return Connection
  if (/评分|用户/.test(name)) return User
  if (/开始|透传/.test(name)) return VideoPlay
  return Document
})
</script>

<template>
  <article class="workflow-card" :data-workflow-id="workflow.id">
    <div class="workflow-card-top"><span class="workflow-card-icon"><component :is="icon" aria-hidden="true" /></span><span class="status-badge" :class="workflow.is_published ? 'success' : 'draft'">{{ workflow.is_published ? '已发布' : '草稿' }}</span></div>
    <h2 class="workflow-card-title"><router-link :to="`/editor/${workflow.id}`" :title="workflow.name">{{ workflow.name }}</router-link></h2>
    <p class="workflow-card-description" :title="workflow.description || '尚未添加说明'">{{ workflow.description || '尚未添加说明' }}</p>
    <div class="workflow-card-footer"><p class="workflow-card-id">#{{ workflow.id }}</p><p class="workflow-card-date">更新于 {{ formatTime(workflow.updated_at) }}</p><div class="workflow-card-actions"><router-link class="workflow-edit" :to="`/editor/${workflow.id}`">编辑</router-link><router-link :to="`/executions?workflowId=${workflow.id}`">执行日志</router-link></div></div>
  </article>
</template>

<style scoped>
.workflow-card { min-width: 0; height: 320px; display: flex; flex-direction: column; padding: 18px; background: #fff; border: 1px solid #dbe3ef; border-radius: 10px; transition: border-color .15s, box-shadow .15s; }
.workflow-card:hover, .workflow-card:focus-within { border-color: #8fbaff; box-shadow: 0 2px 8px #1a5aac0a; }
.workflow-card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.workflow-card-icon { display: inline-flex; align-items: center; justify-content: center; width: 52px; height: 52px; border-radius: 10px; background: #edf4ff; color: #1677ff; }
.workflow-card-icon svg { width: 31px; height: 31px; }
.workflow-card-top .status-badge { margin-top: 2px; }
.workflow-card-title { font-size: 18px; line-height: 1.4; margin: 12px 0 8px; }
.workflow-card-title a { color: #1e293f; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
.workflow-card-description { margin: 0 0 12px; color: #4d5b70; font-size: 14px; line-height: 1.6; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.workflow-card-footer { border-top: 1px solid #e7ecf4; margin-top: auto; padding-top: 8px; }
.workflow-card-id, .workflow-card-date { color: #5b6880; font-size: 13px; line-height: 1.5; margin: 0; overflow-wrap: anywhere; }
.workflow-card-actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 12px; font-size: 14px; }
.workflow-edit { display: inline-flex; justify-content: center; padding: 7px 26px; border: 1px solid #cbd5e3; border-radius: 6px; color: #344056; }
.workflow-card-actions a { white-space: nowrap; }
@media(prefers-reduced-motion: reduce) { .workflow-card { transition: none; } }
</style>
