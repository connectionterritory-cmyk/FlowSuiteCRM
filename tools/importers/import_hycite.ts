import { main } from '../import_hycite'

main().catch((error) => {
  console.error('\n💥 Error fatal:', error instanceof Error ? error.message : error)
  process.exit(1)
})
