import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'
import EditorView from './views/EditorView.vue'

/* Hash 路由:GitHub Pages 静态托管 + file:// 打开都不需要服务端重写规则 */
export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/edit/:id?', name: 'editor', component: EditorView, props: true },
    { path: '/problem/:id', name: 'problem', component: EditorView, props: true }
  ]
})
