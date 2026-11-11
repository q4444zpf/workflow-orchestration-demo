<script setup lang="ts">
import { shallowRef } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { BranchDefinition } from '../../server/src/shared/branches'

const props = defineProps<{ modelValue: BranchDefinition[] }>()
const emit = defineEmits<{ 'update:modelValue': [branches: BranchDefinition[]] }>()
const deleting = shallowRef(false)
function update(id: string, patch: Partial<BranchDefinition>) {
  emit('update:modelValue', props.modelValue.map(branch => branch.id === id ? { ...branch, ...patch } : { ...branch }))
}
function add() {
  const branches = props.modelValue.map(branch => ({ ...branch }))
  const position = branches.findIndex(branch => branch.isDefault)
  branches.splice(position < 0 ? branches.length : position, 0, { id: crypto.randomUUID(), label: '新条件', condition: 'false' })
  emit('update:modelValue', branches)
}
function move(index: number, delta: number) {
  const branches = props.modelValue.map(branch => ({ ...branch }))
  const target = index + delta
  if (target < 0 || target >= branches.length) return
  const [branch] = branches.splice(index, 1)
  branches.splice(target, 0, branch)
  emit('update:modelValue', branches)
}
function setDefault(id: string) {
  emit('update:modelValue', props.modelValue.map(branch => ({ ...branch, isDefault: branch.id === id,
    condition: branch.id === id ? undefined : branch.condition || 'false' })))
}
async function remove(id: string) {
  if (deleting.value || props.modelValue.length <= 1) return
  const branch = props.modelValue.find(branch => branch.id === id)
  if (!branch) return
  deleting.value = true
  try {
    await ElMessageBox.confirm(`确定删除分支“${branch.label}”吗？该出口的连线也会一并删除。`, '删除分支', {
      type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消', closeOnClickModal: false, autofocus: false
    })
    const branches = props.modelValue.filter(branch => branch.id !== id).map(branch => ({ ...branch }))
    if (!branches.some(branch => branch.isDefault) && branches.length) {
      branches[branches.length - 1] = { ...branches[branches.length - 1], isDefault: true, condition: undefined }
    }
    emit('update:modelValue', branches)
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error('删除分支失败，请重试')
  } finally { deleting.value = false }
}
function inputValue(event: Event) { return event.target instanceof HTMLInputElement ? event.target.value : '' }
</script>

<template>
  <section class="branch-editor" aria-label="条件分支配置">
    <p class="branch-help">按顺序选择首个为 true 的条件；全部为 false 时走默认出口。表达式必须返回布尔值。</p>
    <div v-for="(branch, index) in modelValue" :key="branch.id" class="branch-card" :data-branch-id="branch.id">
      <div class="branch-toolbar"><span>出口 {{ index + 1 }}</span><div>
        <button type="button" aria-label="上移分支" :disabled="index === 0" @click="move(index, -1)">↑</button>
        <button type="button" aria-label="下移分支" :disabled="index === modelValue.length - 1" @click="move(index, 1)">↓</button>
        <button type="button" aria-label="删除分支" :disabled="modelValue.length <= 1 || deleting" @click="remove(branch.id)">删除</button>
      </div></div>
      <label class="branch-field">名称<input aria-label="分支名称" :value="branch.label" @input="update(branch.id, { label: inputValue($event) })" /></label>
      <label class="branch-default"><input type="radio" aria-label="默认出口" :checked="!!branch.isDefault" @change="setDefault(branch.id)" />默认出口</label>
      <label v-if="!branch.isDefault" class="branch-field">条件<input aria-label="条件表达式" :value="branch.condition" placeholder="var.score >= 80" @input="update(branch.id, { condition: inputValue($event) })" /></label>
    </div>
    <button type="button" class="add-branch" aria-label="新增条件分支" @click="add">＋ 新增条件分支</button>
  </section>
</template>

<style scoped>
.branch-editor { margin-top: 14px; } .branch-help { color: #748095; font-size: 12px; line-height: 1.7; }
.branch-card { padding: 12px; margin-bottom: 10px; border: 1px solid #dfe5ee; border-radius: 6px; background: #fbfcff; }
.branch-toolbar { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: #748095; }
.branch-toolbar button { background: white; border: 1px solid #dfe5ee; border-radius: 3px; color: #526079; margin-left: 5px; padding: 3px 7px; }
.branch-toolbar button:disabled { opacity: .4; cursor: default; } .branch-field { display: grid; gap: 5px; font-size: 12px; margin-top: 10px; }
.branch-field input { width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid #dfe5ee; border-radius: 4px; color: #26344c; }
.branch-default { display: flex; align-items: center; gap: 5px; margin-top: 10px; font-size: 12px; }
.add-branch { width: 100%; background: #f4f8ff; border: 1px solid #b6d2fc; border-radius: 4px; color: #1677ff; padding: 9px; }
</style>
