import { defineStore } from 'pinia'
import { api, tokenStore } from '@/api'
import type { AuthUser } from '@/types/api'

interface AuthState {
  token: string
  user: AuthUser | null
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    token: tokenStore.get(),
    user: tokenStore.getUser(),
  }),
  getters: {
    isLoggedIn: (s) => !!s.token && !!s.user,
    displayName: (s) => s.user?.nickname || s.user?.username || '未登录',
  },
  actions: {
    async login(username: string, password: string) {
      const res = await api.login(username, password)
      this.token = res.token
      this.user = res.user
      tokenStore.set(res.token)
      tokenStore.setUser(res.user)
    },
    async register(username: string, password: string, nickname?: string) {
      const res = await api.register(username, password, nickname)
      this.token = res.token
      this.user = res.user
      tokenStore.set(res.token)
      tokenStore.setUser(res.user)
    },
    async logout() {
      try {
        await api.logout()
      } catch {
        /* 即使后端失败也清本地 */
      }
      this.token = ''
      this.user = null
      tokenStore.clear()
      tokenStore.setUser(null)
    },
    async refreshMe() {
      this.user = await api.me()
      tokenStore.setUser(this.user)
    },
    async updateNickname(nickname: string) {
      const res = await api.updateNickname(nickname)
      this.user = res.user
      tokenStore.setUser(res.user)
    },
  },
})
