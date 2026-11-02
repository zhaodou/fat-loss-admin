import esbuild from 'esbuild'
console.log('esbuild version', esbuild.version)
try {
  const r = await esbuild.transform('const a: number = 1; export default a', { loader: 'ts', target: 'es2015' })
  console.log('TRANSFORM OK', r.code.trim())
} catch (e) {
  console.log('TRANSFORM FAIL', e?.message, e?.errors)
}
