import { build } from 'vite'
try {
  await build({ logLevel: 'silent' })
  console.log('BUILD OK')
} catch (e) {
  console.log('NAME', e?.name, 'MSG', JSON.stringify(e?.message))
  console.log('CODE', e?.code, 'PLUGIN', e?.plugin, 'ID', e?.id)
  console.log('CAUSE', e?.cause && (e.cause.message || String(e.cause)))
  console.log('ERRORS', e?.errors?.map((x) => x?.message))
  console.log('STACK', String(e?.stack).split('\n').slice(0, 8).join('\n'))
}
