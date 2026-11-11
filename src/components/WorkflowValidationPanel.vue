<script setup lang="ts">
import { CircleCheck, Warning, Close } from '@element-plus/icons-vue'
import type { WorkflowValidationIssue } from '../../server/src/shared/workflowValidation'

defineProps<{ issues: WorkflowValidationIssue[] }>()
defineEmits<{ selectIssue: [issue: WorkflowValidationIssue]; close: [] }>()
</script>

<template>
  <section class="validation-panel" :class="{ valid: !issues.length }" aria-label="工作流校验结果">
    <div class="validation-heading" role="status" aria-live="polite">
      <Warning v-if="issues.length" /><CircleCheck v-else />
      <strong>{{ issues.length ? `校验未通过 · ${issues.length} 项问题` : '校验通过' }}</strong>
      <span>{{ issues.length ? '请修正后再运行或发布' : '工作流基础结构符合要求' }}</span>
      <button class="close-validation" type="button" aria-label="关闭校验结果" @click="$emit('close')"><Close /></button>
    </div>
    <ul v-if="issues.length" class="validation-issues">
      <li v-for="(issue, index) in issues" :key="`${issue.code}-${issue.nodeId}-${issue.edgeId}-${index}`">
        <button v-if="issue.nodeId || issue.edgeId" type="button" class="issue-link" @click="$emit('selectIssue', issue)">{{ issue.message }}<span class="locate-hint">定位</span></button>
        <span v-else>{{ issue.message }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.validation-panel { flex-shrink: 0; border-bottom: 1px solid #f4d7a3; padding: 12px 20px; background: #fffbf3; color: #855414; }
.validation-panel.valid { background: #f3fbf5; color: #287a45; border-color: #cce9d5; }
.validation-heading { display: flex; align-items: center; gap: 8px; min-height: 24px; font-size: 13px; }
.validation-heading > svg { width: 17px; height: 17px; flex-shrink: 0; }
.validation-heading > span { color: #7a879b; font-size: 12px; }
.close-validation { margin-left: auto; padding: 4px; display: flex; border: 0; background: transparent; color: #7a879b; cursor: pointer; }
.close-validation svg { width: 16px; height: 16px; }
.validation-issues { max-height: 132px; overflow-y: auto; margin: 8px 0 0; padding-left: 24px; font-size: 13px; line-height: 1.8; }
.issue-link { border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; padding: 0; }
.issue-link:hover { color: #1677ff; text-decoration: underline; }
.locate-hint { color: #1677ff; font-size: 12px; margin-left: 8px; white-space: nowrap; }
.issue-link:focus-visible, .close-validation:focus-visible { outline: 2px solid #1677ff; outline-offset: 2px; }
</style>
