import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { tokenStore } from '@/api'
import AppLayout from '@/layouts/AppLayout.vue'

const routes: RouteRecordRaw[] = [
  // 登录 / 注册：独立页面，不套用侧边栏布局
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/Login.vue'),
    meta: { title: '登录', requiresAuth: false },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/views/Login.vue'),
    props: { mode: 'register' },
    meta: { title: '注册', requiresAuth: false },
  },
  // 应用主区：所有需要登录的页面都挂在 AppLayout 下
  {
    path: '/',
    component: AppLayout,
    children: [
      { path: '', redirect: '/dashboard' },
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/views/Dashboard.vue'),
        meta: { title: '今日概览', sub: '体重、摄入、消耗与缺口一眼看清', icon: 'Odometer' },
      },
      {
        path: 'diet',
        name: 'diet',
        component: () => import('@/views/Diet.vue'),
        meta: { title: '每日饮食', sub: '三餐 + 加餐，支持搜索、份量与照片识别', icon: 'Bowl' },
      },
      {
        path: 'workout',
        name: 'workout',
        component: () => import('@/views/Workout.vue'),
        meta: { title: '运动记录', sub: '按 MET 估算消耗，可补录轨迹', icon: 'Basketball' },
      },
      {
        path: 'body',
        name: 'body',
        component: () => import('@/views/Body.vue'),
        meta: { title: '体重与身体数据', sub: '趋势比单日数字更重要', icon: 'TrendCharts' },
      },
      {
        path: 'energy',
        name: 'energy',
        component: () => import('@/views/Energy.vue'),
        meta: { title: '热量分析', sub: 'BMR + 日常活动 + 运动 = 总消耗', icon: 'DataLine' },
      },
      {
        path: 'advisor',
        name: 'advisor',
        component: () => import('@/views/Advisor.vue'),
        meta: { title: 'AI 减脂顾问', sub: '每条建议都能追溯到数据', icon: 'MagicStick', badge: 'AI' },
      },
      {
        path: 'assistant',
        name: 'assistant',
        component: () => import('@/views/Assistant.vue'),
        meta: { title: '我的助手', sub: '对话式营养问答：热量、营养、减脂建议', icon: 'ChatDotRound', badge: 'NEW' },
      },
      {
        path: 'stats',
        name: 'stats',
        component: () => import('@/views/Stats.vue'),
        meta: { title: '周 / 月 / 年统计', sub: '趋势、缺口、饮食结构与运动频率', icon: 'PieChart' },
      },
      {
        path: 'goal',
        name: 'goal',
        component: () => import('@/views/Goal.vue'),
        meta: { title: '目标体重', sub: '设定目标并评估可行性', icon: 'Aim' },
      },
      {
        path: 'plan',
        name: 'plan',
        component: () => import('@/views/Plan.vue'),
        meta: { title: '个人减脂计划', sub: '作息决定运动能安排在哪', icon: 'Calendar' },
      },
      {
        path: 'account',
        name: 'account',
        component: () => import('@/views/Account.vue'),
        meta: { title: '个人中心', sub: '账号信息与安全', icon: 'User' },
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('@/views/Settings.vue'),
        meta: { title: '系统设置', sub: '单位、计算规则、数据与隐私', icon: 'Setting' },
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach((to) => {
  const requiresAuth = to.meta?.requiresAuth !== false
  const loggedIn = !!tokenStore.get()

  if (requiresAuth && !loggedIn) {
    return { path: '/login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} }
  }
  // 已登录却访问登录/注册页 → 直接进首页
  if (!requiresAuth && loggedIn && (to.path === '/login' || to.path === '/register')) {
    return { path: '/dashboard' }
  }
})

router.afterEach((to) => {
  const title = (to.meta?.title as string) || '减脂管理后台'
  document.title = `${title} · FitPilot`
})

export default router
