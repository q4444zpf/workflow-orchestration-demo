import { createRouter, createWebHistory } from 'vue-router'
import ApiManager from './views/ApiManager.vue'
import WorkflowEditor from './views/WorkflowEditor.vue'
import WorkflowList from './views/WorkflowList.vue'
import ExecutionHistory from './views/ExecutionHistory.vue'
import ExecutionDetail from './views/ExecutionDetail.vue'

const routes = [
  { path: '/', redirect: '/workflows' },
  { path: '/workflows', component: WorkflowList },
  { path: '/executions', component: ExecutionHistory },
  { path: '/executions/:id', component: ExecutionDetail },
  { path: '/apis', component: ApiManager },
  { path: '/editor/:id?', component: WorkflowEditor }
]

export default createRouter({
  history: createWebHistory(),
  routes
})
