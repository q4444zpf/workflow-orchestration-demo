<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
defineProps<{ title: string; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement>()
let previous: Element | null = null
onMounted(() => { previous = document.activeElement; panel.value?.focus() })
onBeforeUnmount(() => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() })
function trap(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const fields = panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')
  if (!fields?.length) return
  const first = fields[0], last = fields[fields.length - 1]
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
</script>
<template>
  <div class="parameter-backdrop" @keydown.esc.stop.prevent="emit('close')">
    <section ref="panel" class="parameter-dialog" :class="{ wide }" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" @keydown="trap">
      <header><h2>{{ title }}</h2><button type="button" aria-label="关闭参数窗口" @click="emit('close')">×</button></header>
      <div class="parameter-dialog-body"><slot /></div>
    </section>
  </div>
</template>
<style scoped>
.parameter-backdrop { position: fixed; inset: 0; z-index: 2500; background: #18294366; display: grid; place-items: center; padding: 24px; }
.parameter-dialog { width: min(720px, 100%); max-height: 90vh; background: #fff; border-radius: 12px; box-shadow: 0 18px 80px #14213c40; display: flex; flex-direction: column; outline: none; }
.parameter-dialog.wide { width: min(1000px, 100%); }
header { display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; border-bottom: 1px solid var(--line); }
h2 { margin: 0; font-size: 19px; } header button { border: 0; background: none; font-size: 25px; color: #718096; }
.parameter-dialog-body { padding: 20px 24px; overflow: auto; min-height: 0; }
</style>
