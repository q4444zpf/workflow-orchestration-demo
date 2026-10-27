<template>
  <div class="api-manager">
    <el-page-header title="API 注册管理" @back="$router.push('/editor')" />
    <el-button type="primary" @click="openDialog()">注册 API</el-button>
    <el-table v-loading="loading" :data="apis" style="margin-top: 16px">
      <el-table-column prop="name" label="名称" />
      <el-table-column prop="method" label="方法" width="80" />
      <el-table-column prop="url" label="URL" />
      <el-table-column label="操作" width="150">
        <template #default="{ row }">
          <el-button size="small" @click="openDialog(row)">编辑</el-button>
          <el-button size="small" type="danger" @click="remove(row)">删除</el-button>
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
          <el-input
            v-model="form.headers"
            type="textarea"
            :rows="3"
            placeholder='{"Authorization":"Bearer xxx"}'
          />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { apiApi } from '../api/index.js'
import { RegisteredApi } from '../../server/src/types/index.js'

interface ApiForm {
  name: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  url: string
  description?: string
  headers: string
}

const apis = ref<RegisteredApi[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const saving = ref(false)
const form = ref<ApiForm>({ method: 'GET', name: '', url: '', headers: '' })
const editingId = ref<number | null>(null)

async function load() {
  loading.value = true
  try {
    apis.value = await apiApi.list()
  } catch (err: any) {
    ElMessage.error(err?.message || '加载 API 列表失败')
  } finally {
    loading.value = false
  }
}

function openDialog(api?: RegisteredApi) {
  if (api && typeof api.id === 'number') {
    editingId.value = api.id
    form.value = {
      name: api.name,
      method: api.method,
      url: api.url,
      description: api.description,
      headers: JSON.stringify(api.headers || {}, null, 2)
    }
  } else {
    editingId.value = null
    form.value = { method: 'GET', name: '', url: '', headers: '' }
  }
  dialogVisible.value = true
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    const raw = form.value.headers.trim()
    const parsedHeaders = raw ? JSON.parse(raw) : {}
    if (typeof parsedHeaders !== 'object' || parsedHeaders === null || Array.isArray(parsedHeaders)) {
      ElMessage.error('Headers 必须是 JSON 对象')
      return
    }

    const payload: RegisteredApi = {
      name: form.value.name,
      method: form.value.method,
      url: form.value.url,
      description: form.value.description,
      headers: parsedHeaders
    }

    if (editingId.value !== null) {
      await apiApi.update(editingId.value, payload)
    } else {
      await apiApi.create(payload)
    }

    ElMessage.success('保存成功')
    dialogVisible.value = false
    await load()
  } catch (err: any) {
    ElMessage.error(err?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function remove(api?: RegisteredApi) {
  if (!api || typeof api.id !== 'number') return
  try {
    await apiApi.remove(api.id)
    ElMessage.success('删除成功')
    await load()
  } catch (err: any) {
    ElMessage.error(err?.message || '删除失败')
  }
}

onMounted(load)
</script>

<style scoped>
.api-manager { padding: 16px; }
</style>
