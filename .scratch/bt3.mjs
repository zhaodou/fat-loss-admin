import esbuild from 'esbuild'
import fs from 'node:fs'
const big = fs.readFileSync('../node_modules/echarts/dist/echarts.js', 'utf8')
console.log('size', (big.length / 1024 / 1024).toFixed(2), 'MB')
try {
  const r = await esbuild.transform(big, { loader: 'js', target: 'esnext' })
  console.log('LARGE TRANSFORM OK', (r.code.length / 1024 / 1024).toFixed(2), 'MB')
} catch (e) {
  console.log('LARGE TRANSFORM FAIL', JSON.stringify(e?.message), e?.errors?.slice(0, 3))
}
