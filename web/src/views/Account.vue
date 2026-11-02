<template>
  <div class="account-wrap">
    <el-card class="sec" shadow="never">
      <template #header>
        <div class="sec-head">
          <el-icon><User /></el-icon>
          <span>账号信息</span>
        </div>
      </template>

      <el-form label-width="90px" class="info-form">
        <el-form-item label="账号">
          <el-input :model-value="auth.user?.username" disabled />
        </el-form-item>
        <el-form-item label="昵称">
          <el-input v-model="nickname" placeholder="展示名称，最多 20 字" maxlength="20" show-word-limit />
        </el-form-item>
        <el-form-item label="注册时间">
          <el-input :model-value="formatDate(auth.user?.created_at)" disabled />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="savingNick" @click="saveNickname">保存昵称</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="sec" shadow="never">
      <template #header>
        <div class="sec-head">
          <el-icon><Lock /></el-icon>
          <span>修改密码</span>
        </div>
      </template>

      <el-form ref="pwRef" :model="pw" :rules="pwRules" label-width="90px" class="info-form">
        <el-form-item label="原密码" prop="oldPassword">
          <el-input v-model="pw.oldPassword" type="password" show-password placeholder="请输入当前密码" />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input v-model="pw.newPassword" type="password" show-password placeholder="6-15 位，含字母、数字、特殊字符" />
        </el-form-item>
        <el-form-item label="确认密码" prop="confirm">
          <el-input v-model="pw.confirm" type="password" show-password placeholder="再次输入新密码" @keyup.enter="savePassword" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="savingPw" @click="savePassword">更新密码</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { Lock, User } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import { api } from '@/api'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const nickname = ref(auth.user?.nickname || '')
const savingNick = ref(false)

const pwRef = ref<FormInstance>()
const savingPw = ref(false)
const pw = reactive({ oldPassword: '', newPassword: '', confirm: '' })

function formatDate(s?: string): string {
  if (!s) return '—'
  return s.replace('T', ' ').slice(0, 19)
}

function validateNewPassword(_r: unknown, value: string, cb: (e?: Error) => void) {
  if (!value) return cb(new Error('请输入新密码'))
  if (value.length < 6 || value.length > 15) return cb(new Error('密码长度需为 6-15 位'))
  if (!/[A-Za-z]/.test(value)) return cb(new Error('需包含字母'))
  if (!/[0-9]/.test(value)) return cb(new Error('需包含数字'))
  if (!/[^A-Za-z0-9]/.test(value)) return cb(new Error('需包含特殊字符'))
  cb()
}

const pwRules = reactive<FormRules<typeof pw>>({
  oldPassword: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  newPassword: [{ required: true, validator: validateNewPassword, trigger: 'blur' }],
  confirm: [
    {
      validator: (_r, value, cb) => {
        if (!value) return cb(new Error('请再次输入新密码'))
        if (value !== pw.newPassword) return cb(new Error('两次输入的密码不一致'))
        cb()
      },
      trigger: 'blur',
    },
  ],
})

async function saveNickname() {
  const next = nickname.value.trim()
  if (!next) {
    ElMessage.warning('昵称不能为空')
    return
  }
  savingNick.value = true
  try {
    await auth.updateNickname(next)
    ElMessage.success('昵称已更新')
  } catch {
    /* 拦截器已提示 */
  } finally {
    savingNick.value = false
  }
}

async function savePassword() {
  if (!pwRef.value) return
  try {
    await pwRef.value.validate()
  } catch {
    return
  }
  savingPw.value = true
  try {
    const res = await api.changePassword(pw.oldPassword, pw.newPassword)
    if (res.ok) {
      ElMessage.success('密码已更新')
      pw.oldPassword = ''
      pw.newPassword = ''
      pw.confirm = ''
      pwRef.value?.resetFields()
    }
  } catch {
    /* 拦截器已提示 */
  } finally {
    savingPw.value = false
  }
}
</script>

<style scoped>
.account-wrap {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 18px;
}
.sec-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  color: var(--ink-800);
}
.info-form {
  max-width: 420px;
}
@media (max-width: 860px) {
  .account-wrap {
    grid-template-columns: 1fr;
  }
}
</style>
