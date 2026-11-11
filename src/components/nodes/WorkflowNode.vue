<template>
  <div class="workflow-node" :class="[state?.status, { selected }]" :style="{ '--node-color': meta.color, minHeight: branches.length ? `${Math.max(48, branches.length * 29 + 22)}px` : undefined }">
    <Handle v-if="type !== 'start'" type="target" :position="Position.Left" />
    <component :is="meta.icon" class="type-icon" /><span class="node-name">{{ nodeName({ id, type, data }) }}</span>
    <CircleCheckFilled v-if="state?.status === 'success'" class="node-status success-icon" />
    <CircleCloseFilled v-else-if="state?.status === 'failed'" class="node-status failed-icon" />
    <Loading v-else-if="state?.status === 'running'" class="node-status spinning" />
    <span v-else-if="execution && !state" class="not-executed">未执行</span>
    <template v-if="type === 'branch'"><div v-for="(branch, index) in branches" :key="branch.id" class="branch-exit" :style="{ top: `${(index + 1) * 100 / (branches.length + 1)}%` }"><span>{{ branch.label }}{{ branch.isDefault ? '（默认）' : '' }}</span><Handle :id="branch.id" type="source" :position="Position.Right" :title="branch.label" /></div></template>
    <Handle v-else-if="type !== 'end'" type="source" :position="Position.Right" />
  </div>
</template>
<script setup lang="ts">
import { computed, inject, watch, type Ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { CircleCheckFilled, CircleCloseFilled, Loading } from '@element-plus/icons-vue'
import { nodeMeta, nodeName } from '../nodePresentation'
import type { Execution } from '../../types'
import { getBranchDefinitions } from '../../../server/src/shared/branches'
const props = defineProps<{ id: string; type: string; data: Record<string, unknown>; selected?: boolean }>()
const emit = defineEmits<{ updateNodeInternals: [] }>()
const execution = inject<Ref<Execution | null>>('workflow-execution', computed(() => null))
const state = computed(() => execution.value?.context[props.id])
const meta = computed(() => nodeMeta(props.type))
const branches = computed(() => props.type === 'branch' ? getBranchDefinitions(props.data) : [])
// 排序不一定改变节点尺寸，需在 DOM 更新后刷新出口坐标，连线才能跟随稳定 ID。
watch(() => JSON.stringify(branches.value.map(branch => branch.id)), () => emit('updateNodeInternals'), { flush: 'post' })
</script>
<style scoped>
.workflow-node { min-width: 116px; min-height: 48px; box-sizing: border-box; display: flex; align-items: center; gap: 10px; padding: 12px 16px; border: 1.5px solid #c7cfdd; border-radius: 8px; background: #fff; position: relative; color: #203049; box-shadow: 0 2px 4px #20304904; }
.node-name { font-weight: 600; font-size: 14px; white-space: nowrap; } .type-icon { width: 21px; height: 21px; color: var(--node-color); }
.workflow-node:has(.branch-exit) { padding-right: 104px; } .branch-exit { position: absolute; right: 0; transform: translateY(-50%); height: 20px; display: flex; align-items: center; } .branch-exit span { max-width: 96px; padding-right: 12px; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #748095; }
.workflow-node.success { border-color: #42aa35; background: #fbfff9; } .workflow-node.failed { border-color: #e05252; } .workflow-node.running { border-color: #1677ff; } .workflow-node.selected { outline: 2px solid #1677ff; outline-offset: 2px; background: #f5f9ff; }
.node-status { position: absolute; top: -10px; right: -8px; width: 21px; height: 21px; background: white; border-radius: 50%; color: #1677ff; } .success-icon { color: #32a332; } .failed-icon { color: #dc4747; } .not-executed { position: absolute; top: 100%; right: 0; font-size: 10px; color: #8791a0; margin-top: 3px; }
:deep(.vue-flow__handle) { width: 6px; height: 6px; background: #8493a9; border: 1.5px solid white; } .success :deep(.vue-flow__handle) { background: #42aa35; }
</style>
