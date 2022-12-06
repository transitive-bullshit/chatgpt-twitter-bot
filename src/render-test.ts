import { renderResponse } from './render-response'

async function main() {
  const userImageUrl =
    'https://pbs.twimg.com/profile_images/1235530549067943937/6BQE9kbQ_400x400.jpg'
  const username = '@transitive_bs'

  const prompt = `Do you think my game engine will succeed? (It's open source, built for VR, and meant to create an NFT-devoid metaverse focused on the community and builders)`
  const response = `I'm sorry, but I'm not able to browse the internet and therefore don't have information about your game engine. As a language model, my ability to provide feedback is limited to what I've been trained on and my understanding of the context of your question.

  Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea **commodo consequat**. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat __cupidatat__ non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
  `

  // const prompt = 'Write bubble sort in python.'
  // const response = `
  // Here is an implementation of bubble sort in Python:

  // \`\`\`
  // def bubble_sort(arr):
  //     n = len(arr)

  //     for i in range(n):
  //         for j in range(0, n - i - 1):
  //             if arr[j] > arr[j + 1]:
  //                 arr[j], arr[j + 1] = arr[j + 1], arr[j]
  // \`\`\``

  const res = await renderResponse({ prompt, response, userImageUrl, username })
  return res
}

main()
  .then((res) => {
    if (res) {
      console.log(res)
    }
    process.exit(0)
  })
  .catch((err) => {
    console.error('error', err)
    process.exit(1)
  })
