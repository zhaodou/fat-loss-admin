import { defineStore } from 'pinia'
import { api } from '@/api'
import { localDate } from '@/utils/format'
import type { Plan, Profile, Settings } from '@/types/api'

interface State {
  today: string
  profile: Profile | null
  settings: Settings | null
  plan: Plan | null
  loading: boolean
  version: number
}

export const useAppStore = defineStore('app', {
  state: (): State => ({
    today: localDate(),
    profile: null,
    settings: null,
    plan: null,
    loading: false,
    version: 0,
  }),
  getters: {
    nickname: (s) => s.profile?.nickname ?? '我',
    weightUnit: (s) => (s.settings?.units.weight === 'jin' ? '斤' : 'kg'),
    energyUnit: (s) => (s.settings?.units.energy === 'kj' ? 'kJ' : 'kcal'),
    hideWeight: (s) => !!s.settings?.privacy.hideWeight,
  },
  actions: {
    async bootstrap() {
      this.loading = true
      try {
        const [profile, settings, plan] = await Promise.all([api.profile(), api.settings(), api.plan()])
        this.profile = profile
        this.settings = settings
        this.plan = plan
      } finally {
        this.loading = false
      }
    },
    async refresh() {
      const [profile, settings, plan] = await Promise.all([api.profile(), api.settings(), api.plan()])
      this.profile = profile
      this.settings = settings
      this.plan = plan
      this.version++
    },
    /** 数据发生变化时调用，让各页面知道该重新拉取 */
    touch() {
      this.version++
    },
  },
})
