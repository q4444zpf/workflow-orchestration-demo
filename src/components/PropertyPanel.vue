<template>
  <div class="property-panel">
    <h4>属性面板</h4>
    <div v-if="node">
      <p>ID: {{ node.id }}</p>
      <p>Type: {{ node.type }}</p>
      <el-form label-position="top">
        <el-form-item label="Label">
          <el-input v-model="label" placeholder="节点名称" />
        </el-form-item>
      </el-form>
    </div>
    <div v-else>
      <p>请选择一个节点</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Node } from '@vue-flow/core'
import { RegisteredApi } from '../../server/src/types/index.js'

type TypedNode = Node & { type: string; data: Record<string, unknown> }

const props = defineProps<{ node: TypedNode | null; apis: RegisteredApi[] }>()
const emit = defineEmits<{ (e: 'update:node', node: TypedNode): void }>()

const label = computed({
  get: () => {
    const raw = props.node?.data?.label
    return typeof raw === 'string' ? raw : ''
  },
  set: (value) => {
    if (!props.node) return
    emit('update:node', {
      ...props.node,
      data: { ...(props.node.data || {}), label: value }
    })
  }
})
</script>

<style scoped>
.property-panel { width: 240px; padding: 12px; border-left: 1px solid #dcdfe6; }
</style>
