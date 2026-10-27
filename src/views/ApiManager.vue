<template>
  <div class="api-manager">
    <el-page-header title="API 注册管理" @back="$router.push('/editor')" />
    <el-button type="primary" @click="openDialog()">注册 API</el-button>
    <el-table :data="apis" style="margin-top: 16px">
      <el-table-column prop="name" label="名称" />
      <el-table-column prop="method" label="方法" width="80" />
      <el-table-column prop="url" label="URL" />
      <el-table-column label="操作" width="150">
        <template #default="{ row }">
          <el-button size="small" @click="openDialog(row)">编辑</el-button>
          <el-button size="small" type="danger" @click="remove(row.id)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" title="注册 API" width="600px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="名称">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="方法">
          <el-select v-model="form.method">
            <el-option label="GET" value="GET" />
            <el-option label="POST" value="POST" />
            <el-option label="PUT" value="PUT" />
            <el-option label="DELETE" value="DELETE" />
          </el-select>
        </el-form-item>
        <el-form-item label="URL">
          <el-input v-model="form.url" />
        </el-form-item>
        <el-form-item label="Headers">
          <el-input v-model="form.headers" type="textarea" :rows="3" placeholder='{"Authorization":"Bearer xxx"}' />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { apiApi } from '../api/index.js'
import { RegisteredApi } from '../../server/src/types/index.js'

const apis = ref<RegisteredApi[]>([])
const dialogVisible = ref(false)
const form = ref<Partial<RegisteredApi>>({ method: 'GET', headers: {} })
const editingId = ref<number | null>(null)

async function load() {
  apis.value = await apiApi.list()
}

function openDialog(api?: RegisteredApi) {
  if (api) {
    editingId.value = api.id!
    form.value = { ...api, headers: api.headers || {} }
  } else {
    editingId.value = null
    form.value = { method: 'GET', headers: {} }
  }
  dialogVisible.value = true
}

async function save() {
  const rawHeaders = form.value.headers as any
  const payload = {
    ...form.value,
    headers: typeof rawHeaders === 'string' ? JSON.parse(rawHeaders) : rawHeaders
  } as RegisteredApi
  if (editingId.value) {
    await apiApi.update(editingId.value, payload)
  } else {
    await apiApi.create(payload)
  }
  dialogVisible.value = false
  await load()
}

async function remove(id?: number) {
  if (!id) return
  await apiApi.remove(id)
  await load()
}

onMounted(load)
</script>

<style scoped>
.api-manager { padding: 16px; }
</style>
