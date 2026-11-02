import { systemPrompt } from '../server/src/services/assistant'
const p = systemPrompt()
const idx = p.indexOf('【用户档案】')
console.log('总长度', p.length, '字符')
console.log(p.slice(idx))
