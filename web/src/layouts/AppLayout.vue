<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">🥗</div>
        <div>
          <div class="brand-name">FitPilot</div>
          <div class="brand-sub">AI 减脂管理后台</div>
        </div>
      </div>

      <template v-for="group in navGroups" :key="group.label">
        <div class="nav-group-label">{{ group.label }}</div>
        <router-link
          v-for="item in group.items"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ active: route.path === item.path }"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.title }}</span>
          <span v-if="item.badge" class="nav-badge">{{ item.badge }}</span>
        </router-link>
      </template>

      <div class="sidebar-foot">
        <div>数据只存在本机 SQLite</div>
        <div>v1.0 · Vue3 + TS + Element Plus</div>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <div>
          <h1>{{ pageTitle }}</h1>
          <div class="sub">{{ pageSub }}</div>
        </div>
        <div class="topbar-actions">
          <el-tag v-if="store.profile" round effect="plain" type="success">
            BMI {{ store.profile.bmi }} · {{ store.profile.bmiCategory.label }}
          </el-tag>
          <el-dropdown trigger="click" @command="onCommand">
            <span class="user-trigger">
              <el-avatar :size="30" class="user-avatar">{{ auth.displayName.charAt(0) }}</el-avatar>
              <span class="user-name">{{ auth.displayName }}</span>
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="account" :icon="User">个人中心</el-dropdown-item>
                <el-dropdown-item command="logout" :icon="SwitchButton" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button :icon="Calendar" plain @click="goToday">{{ todayLabel }}</el-button>
          <el-button type="primary" :icon="Plus" @click="handleQuickLog">快速记录</el-button>
        </div>
      </header>

      <main class="content">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" :key="route.path + store.version" />
          </transition>
        </router-view>
      </main>
    </div>

    <QuickLogDialog v-model="quickOpen" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowDown, Calendar, Plus, SwitchButton, User } from '@element-plus/icons-vue'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { localDate, prettyDate, weekday } from '@/utils/format'
import QuickLogDialog from '@/components/QuickLogDialog.vue'

const route = useRoute()
const router = useRouter()
const store = useAppStore()
const auth = useAuthStore()
const quickOpen = ref(false)

const navGroups = [
  {
    label: 'Account',
    items: [
      { path: '/account', title: '个人中心', icon: 'User' },
    ],
  },
  {
    label: 'Overview',
    items: [
      { path: '/dashboard', title: '今日概览', icon: 'Odometer' },
      { path: '/energy', title: '热量分析', icon: 'DataLine' },
      { path: '/advisor', title: 'AI 减脂顾问', icon: 'MagicStick', badge: 'AI' },
      { path: '/assistant', title: '我的助手', icon: 'ChatDotRound', badge: 'NEW' },
    ],
  },
  {
    label: 'Tracking',
    items: [
      { path: '/diet', title: '每日饮食', icon: 'Bowl' },
      { path: '/workout', title: '运动记录', icon: 'Basketball' },
      { path: '/body', title: '体重与身体', icon: 'TrendCharts' },
    ],
  },
  {
    label: 'Planning',
    items: [
      { path: '/goal', title: '目标体重', icon: 'Aim' },
      { path: '/plan', title: '个人减脂计划', icon: 'Calendar' },
    ],
  },
  {
    label: 'Data',
    items: [
      { path: '/stats', title: '周 / 月 / 年统计', icon: 'PieChart' },
      { path: '/settings', title: '系统设置', icon: 'Setting' },
    ],
  },
]

const pageTitle = computed(() => (route.meta?.title as string) || '今日概览')
const pageSub = computed(() => (route.meta?.sub as string) || '')
const todayLabel = computed(() => {
  const d = localDate()
  return `${prettyDate(d)} ${weekday(d)}`
})

function goToday() {
  store.today = localDate()
  router.push({ path: route.path, query: { date: localDate() } })
}

function handleQuickLog() {
  quickOpen.value = true
}

async function onCommand(cmd: string) {
  if (cmd === 'account') {
    router.push('/account')
  } else if (cmd === 'logout') {
    await auth.logout()
    router.push('/login')
  }
}

onMounted(async () => {
  if (!store.profile) await store.bootstrap()
})
</script>
