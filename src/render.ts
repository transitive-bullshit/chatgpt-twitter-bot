import { renderResponse } from './render-response'

/**
 * CLI for testing the image rendering.
 */
async function main() {
  const userImageUrl =
    'https://pbs.twimg.com/profile_images/1235530549067943937/6BQE9kbQ_400x400.jpg'
  const username = '@transitive_bs'

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
  // \`\`\`

  // Does this work for you?`

  const prompt = 'Write me a cheerful Christmas poem about web development.'
  const response =
    "'Twas the night before Christmas, and all through the site\n" +
    'Not a line of code was wrong or out of place\n' +
    'The HTML was valid, the CSS precise\n' +
    'And all the Javascript ran without a trace\n' +
    '\n' +
    'The web developer had finished their work\n' +
    'And sat back with a satisfied smirk\n' +
    'They knew their site would bring holiday cheer\n' +
    'To all who visited, near and far, my dear\n' +
    '\n' +
    'The site was responsive, fast and sleek\n' +
    'With animation, color and style unique\n' +
    'It was a true work of art, this web development feat\n' +
    "And the web developer's heart was full and sweet\n" +
    '\n' +
    'So on this Christmas Eve, let us all give thanks\n' +
    'To the hardworking web developers, who make our online world rank\n' +
    'For they bring joy and cheer, with their coding skills so fine\n' +
    'Merry Christmas to all, and to all a good time!'

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
