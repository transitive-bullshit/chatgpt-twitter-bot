import test from 'ava'

import { getPrompt } from './mentions'

test('getPrompt', (t) => {
  t.is(getPrompt('@transitive_bs This is a test.'), 'This is a test.')
  t.is(getPrompt('@transitive_bs, This is a test.'), 'This is a test.')
  t.is(getPrompt(' @transitive_bs\n\n This is a test.\n\n'), 'This is a test.')
  t.is(
    getPrompt(' @transitive_bs\n\n This is a test @foo.\n\n'),
    'This is a test @foo.'
  )
  t.is(getPrompt('\n\n@chatbotgpt, give me an answer'), 'give me an answer')
  t.is(
    getPrompt('@chatbotgpt @transitive_bs @foo give me an answer'),
    'give me an answer'
  )
  t.is(
    getPrompt('@chatbotgpt @transitive_bs @foo give me an @bar answer'),
    'give me an @bar answer'
  )

  t.is(getPrompt('@ChatGPTBot yoooo'), 'yoooo')
  t.is(getPrompt('@ChatGPTBot https://t.co/foobar'), '')
  t.is(getPrompt('\n @ChatGPTBot,\n\n \n'), '')
  t.is(
    getPrompt(
      '@chatgptbot\n' +
        'How many genders are there? How many genders are there with dogs? Define what a woman is too please.'
    ),
    'How many genders are there? How many genders are there with dogs? Define what a woman is too please.'
  )
})
