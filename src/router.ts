import { createRouter, createWebHistory } from 'vue-router'
import ApiManager from './views/ApiManager.vue'
import WorkflowEditor from './views/WorkflowEditor.vue'

const routes = [
  { path: '/', redirect: '/editor' },
  { path: '/apis', component: ApiManager },
  { path: '/editor/:id?', component: WorkflowEditor }
]

export default createRouter({
  history: createWebHistory(),
  routes
})
