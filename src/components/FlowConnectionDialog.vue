<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Connection, Edge, Node } from '@vue-flow/core'
import { getBranchDefinitions } from '../../server/src/shared/branches'
import { nodeName } from './nodePresentation'
import ParameterDialog from './parameters/ParameterDialog.vue'

const props = defineProps<{ nodes: Node[]; edges: (Edge & { branchId?: string })[] }>()
const emit = defineEmits<{ connect: [connection: Connection & Pick<Edge, 'label'>]; close: [] }>()
const source = ref('')
const target = ref('')
const exit = ref('')
const sourceNode = computed(() => props.nodes.find(node => node.id === source.value && node.type !== 'end'))
const sources = computed(() => props.nodes.filter(node => node.type !== 'end'))
const targets = computed(() => props.nodes.filter(node => node.type !== 'start' && node.id !== source.value))
const outgoing = computed(() => props.edges.filter(edge => edge.source === source.value))
const sourceType = computed(() => sourceNode.value?.type)
const hasExits = computed(() => ['branch', 'loop', 'parallel'].includes(sourceType.value || ''))
const exits = computed(() => {
  const used = new Set(outgoing.value.map(edge => sourceType.value === 'branch' ? edge.branchId || edge.sourceHandle || edge.label : edge.label))
  if (sourceType.value === 'branch' && sourceNode.value) {
    return getBranchDefinitions(sourceNode.value.data || {})
      .filter(branch => !used.has(branch.id))
      .map(branch => ({ value: branch.id, label: branch.label + (branch.isDefault ? '（默认）' : '') }))
  }
  if (sourceType.value === 'loop') {
    return [{ value: 'body', label: '循环体（body）' }, { value: 'next', label: '后续（next）' }].filter(option => !used.has(option.value))
  }
  if (sourceType.value === 'parallel') {
    const fork = Array.from({ length: outgoing.value.length + 1 }, (_, index) => `fork-${index}`).find(label => !used.has(label))!
    return [{ value: fork, label: `新增支路（${fork}）` }, { value: 'join', label: '汇合（join）' }].filter(option => !used.has(option.value))
  }
  return []
})
const canConnect = computed(() => !!sourceNode.value && targets.value.some(node => node.id === target.value)
  && (hasExits.value ? exits.value.some(option => option.value === exit.value) : !outgoing.value.length))

function optionName(node: Node) {
  return nodeName({ id: node.id, type: node.type || '', data: node.data || {} })
}
function nodeOption(node: Node) {
  const name = optionName(node)
  return props.nodes.some(other => other.id !== node.id && optionName(other) === name) ? `${name}（${node.id}）` : name
}
function submit() {
  if (!canConnect.value) return
  const branch = sourceType.value === 'branch'
  emit('connect', { source: source.value, target: target.value, sourceHandle: branch ? exit.value : null, targetHandle: null,
    label: hasExits.value && !branch ? exit.value : undefined })
}
</script>

<template>
  <ParameterDialog title="添加连线" @close="emit('close')">
    <form class="connection-form" @submit.prevent="submit">
      <label>起点节点<select v-model="source" aria-label="起点节点" @change="exit = ''; target = ''"><option value="" disabled>选择起点</option><option v-for="node in sources" :key="node.id" :value="node.id">{{ nodeOption(node) }}</option></select></label>
      <label v-if="hasExits && exits.length">起点出口<select v-model="exit" aria-label="起点出口"><option value="" disabled>选择出口</option><option v-for="option in exits" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
      <p v-if="sourceNode && (hasExits ? !exits.length : outgoing.length)" role="status">起点没有可用出口，请选择其他起点。</p>
      <label>终点节点<select v-model="target" aria-label="终点节点" :disabled="!sourceNode"><option value="" disabled>选择终点</option><option v-for="node in targets" :key="node.id" :value="node.id">{{ nodeOption(node) }}</option></select></label>
      <footer><button type="button" @click="emit('close')">取消</button><button type="submit" class="primary" :disabled="!canConnect">添加连线</button></footer>
    </form>
  </ParameterDialog>
</template>

<style scoped>
.connection-form { display: grid; gap: 14px; }
.connection-form label { display: grid; gap: 6px; font-size: 14px; }
.connection-form p { margin: 0; color: #526079; font-size: 13px; }
select, button { border: 1px solid #dce3ec; border-radius: 6px; padding: 8px 12px; background: #fff; color: #24344d; }
footer { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
.primary { background: #1677ff; color: white; border-color: #1677ff; }
.primary:disabled { background: #f1f4fa; color: #526079; border-color: #dce3ec; }
</style>
