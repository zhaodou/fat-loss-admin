<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="auth-brand">
        <div class="auth-mark">🥗</div>
        <div>
          <div class="auth-title">FitPilot</div>
          <div class="auth-sub">AI 减脂管理后台</div>
        </div>
      </div>

      <h2 class="auth-heading">{{ mode === 'register' ? '创建账号' : '欢迎回来' }}</h2>
      <p class="auth-desc">{{ mode === 'register' ? '注册一个新账号以使用本系统' : '登录以继续你的减脂管理' }}</p>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
        <el-form-item label="账号" prop="username">
          <el-input v-model="form.username" placeholder="最多 8 位，字母 / 数字 / 下划线" clearable :prefix-icon="User" />
        </el-form-item>

        <el-form-item v-if="mode === 'register'" label="昵称" prop="nickname">
          <el-input v-model="form.nickname" placeholder="展示名称，最多 20 字（可留空）" clearable :prefix-icon="EditPen" />
        </el-form-item>

        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            placeholder="6-15 位，含字母、数字、特殊字符"
            :prefix-icon="Lock"
            @keyup.enter="submit"
          />
        </el-form-item>

        <el-button type="primary" class="auth-submit" :loading="loading" @click="submit">
          {{ mode === 'register' ? '注册并登录' : '登录' }}
        </el-button>
      </el-form>

      <div class="auth-foot">
        <template v-if="mode === 'register'">
          已有账号？<router-link to="/login">去登录</router-link>
        </template>
        <template v-else>
          还没有账号？<router-link to="/register">立即注册</router-link>
        </template>
      </div>

      <div v-if="mode !== 'register'" class="auth-hint">
        默认账号：<b>user</b> · 默认密码：<b>user@123.</b>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { EditPen, Lock, User } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const props = withDefaults(defineProps<{ mode?: 'login' | 'register' }>(), { mode: 'login' })

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const formRef = ref<FormInstance>()
const loading = ref(false)

const form = reactive({
  username: '',
  nickname: '',
  password: '',
})

const rules = reactive<FormRules<typeof form>>({
  username: [
    { required: true, message: '请输入账号', trigger: 'blur' },
    { pattern: /^[A-Za-z0-9_]+$/, message: '账号只能包含字母、数字和下划线', trigger: 'blur' },
    { max: 8, message: '账号最多 8 位字符', trigger: 'blur' },
  ],
  nickname: [{ max: 20, message: '昵称最多 20 个字符', trigger: 'blur' }],
  password: [{ required: true, validator: validatePassword, trigger: 'blur' }],
})

function validatePassword(_rule: unknown, value: string, cb: (err?: Error) => void) {
  if (!value) return cb(new Error('请输入密码'))
  if (value.length < 6 || value.length > 15) return cb(new Error('密码长度需为 6-15 位'))
  if (!/[A-Za-z]/.test(value)) return cb(new Error('密码需包含字母'))
  if (!/[0-9]/.test(value)) return cb(new Error('密码需包含数字'))
  if (!/[^A-Za-z0-9]/.test(value)) return cb(new Error('密码需包含特殊字符'))
  cb()
}

const redirect = computed(() => (route.query.redirect as string) || '/dashboard')

async function submit() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  loading.value = true
  try {
    if (props.mode === 'register') {
      await auth.register(form.username.trim(), form.password, form.nickname.trim() || undefined)
      ElMessage.success('注册成功，已自动登录')
    } else {
      await auth.login(form.username.trim(), form.password)
      ElMessage.success('登录成功')
    }
    router.replace(redirect.value)
  } catch {
    /* 错误信息已由全局拦截器提示 */
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: linear-gradient(135deg, var(--brand-50, #eef6ff) 0%, #f7fbff 100%);
}
.auth-card {
  width: 100%;
  max-width: 380px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: var(--shadow-md, 0 12px 40px rgba(20, 40, 80, 0.1));
  padding: 30px 28px 24px;
}
.auth-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}
.auth-mark {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-size: 24px;
  background: var(--brand-50, #eef6ff);
}
.auth-title {
  font-size: 18px;
  font-weight: 800;
  color: var(--ink-800);
}
.auth-sub {
  font-size: 12px;
  color: var(--ink-500);
}
.auth-heading {
  font-size: 20px;
  font-weight: 700;
  color: var(--ink-800);
  margin: 4px 0 2px;
}
.auth-desc {
  font-size: 13px;
  color: var(--ink-500);
  margin-bottom: 18px;
}
.auth-submit {
  width: 100%;
  margin-top: 6px;
}
.auth-foot {
  margin-top: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--ink-500);
}
.auth-foot a {
  color: var(--brand-500);
  font-weight: 600;
  text-decoration: none;
}
.auth-hint {
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--brand-50, #eef6ff);
  color: var(--brand-700, #1d4ed8);
  font-size: 12.5px;
  text-align: center;
}
.auth-hint b {
  font-weight: 700;
}
</style>
