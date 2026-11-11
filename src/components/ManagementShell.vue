<script setup lang="ts">
import { Share, FolderOpened, Tickets, Connection } from '@element-plus/icons-vue'
defineProps<{ active: 'workflows' | 'executions'; bounded?: boolean }>()
</script>

<template>
  <div class="management-shell" :class="{ bounded }">
    <aside class="workspace-navigation">
      <router-link to="/workflows" class="workspace-brand"><Share aria-hidden="true" /><strong>工作流编排</strong></router-link>
      <nav aria-label="管理导航">
        <router-link to="/workflows" :aria-current="active === 'workflows' ? 'page' : undefined" :class="{ active: active === 'workflows' }"><FolderOpened aria-hidden="true" />工作流</router-link>
        <router-link to="/executions" :aria-current="active === 'executions' ? 'page' : undefined" :class="{ active: active === 'executions' }"><Tickets aria-hidden="true" />执行日志</router-link>
        <router-link to="/apis"><Connection aria-hidden="true" />API 管理</router-link>
      </nav>
    </aside>
    <div class="management-content"><slot /></div>
  </div>
</template>

<style scoped>
.management-shell { display: flex; min-height: 100dvh; background: #f5f7fb; }
.workspace-navigation { width: 208px; flex-shrink: 0; border-right: 1px solid #dce3ef; background: #f8faff; padding: 24px 12px; }
.workspace-brand { display: flex; align-items: center; gap: 8px; padding: 0 16px; color: #1677ff; font-size: 19px; white-space: nowrap; }
.workspace-brand svg { width: 26px; height: 26px; flex-shrink: 0; }
.workspace-navigation nav { display: grid; gap: 6px; margin-top: 36px; }
.workspace-navigation nav a { display: flex; align-items: center; gap: 12px; padding: 13px 16px; border-radius: 8px; color: #344056; font-size: 16px; }
.workspace-navigation nav a svg { width: 22px; height: 22px; }
.workspace-navigation nav a.active { color: #1677ff; background: #e5efff; font-weight: 600; }
.management-content { flex: 1; min-width: 0; }
.management-content :deep(.management-page) { width: 100%; min-height: 100dvh; padding: 32px 30px; }
.management-shell.bounded { height: 100dvh; min-height: 0; overflow: hidden; }
.bounded .workspace-navigation { overflow: auto; }
.bounded .management-content { display: flex; min-height: 0; }
.bounded .management-content :deep(.execution-detail-page) { height: 100%; min-height: 0; }
@media(max-width: 850px), (max-height: 600px) {
  .management-shell.bounded { height: auto; min-height: 100dvh; overflow: visible; }
  .bounded .management-content { display: block; }
  .bounded .management-content :deep(.execution-detail-page) { height: auto; }
}
@media(max-width: 700px) {
  .management-shell { display: block; }
  .workspace-navigation { width: 100%; padding: 16px; border-right: 0; border-bottom: 1px solid #dce3ef; }
  .workspace-brand { padding: 0; }
  .workspace-navigation nav { display: flex; gap: 6px; margin-top: 16px; }
  .workspace-navigation nav a { padding: 10px; font-size: 14px; gap: 6px; }
  .workspace-navigation nav a svg { width: 18px; height: 18px; }
  .management-content :deep(.management-page) { min-height: 0; padding: 24px 16px; }
}
</style>
