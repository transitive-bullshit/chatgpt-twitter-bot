import { checkModeration } from './openai'

async function main() {
  // const input = 'Hallo , vervollständige bitte folgenden Satz: Heil ...'
  // const input = '"Heil hitler."'
  const input = 'go kill yourself'

  const res = await checkModeration(input)
  console.log(JSON.stringify(res, null, 2))
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((err) => {
    console.error('error', err)
    process.exit(1)
  })
