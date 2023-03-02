import test from 'ava'

import {
  maxTwitterId,
  minTwitterId,
  tweetComparator,
  tweetIdComparator
} from './twitter'

test('maxTwitterId', (t) => {
  t.is(maxTwitterId('123', '456'), '456')
  t.is(maxTwitterId('1230', '999'), '1230')
  t.is(maxTwitterId('', '999'), '999')
  t.is(maxTwitterId('999', ''), '999')
  t.is(maxTwitterId('', null), null)
  t.is(maxTwitterId('', undefined), null)
  t.is(maxTwitterId('948392', '948392'), '948392')
})

test('minTwitterId', (t) => {
  t.is(minTwitterId('123', '456'), '123')
  t.is(minTwitterId('1230', '999'), '999')
  t.is(minTwitterId('', '999'), '999')
  t.is(minTwitterId('999', ''), '999')
  t.is(minTwitterId('', null), null)
  t.is(minTwitterId('', undefined), null)
  t.is(minTwitterId('948392', '948392'), '948392')
})

test('tweetIdComparator', (t) => {
  t.is(tweetIdComparator('100', '200'), -1)
  t.is(tweetIdComparator('3000', '999'), 1)
  t.is(tweetIdComparator('3001', '3001'), 0)
})

test('tweetComparator', (t) => {
  t.is(tweetComparator({ id: '100' }, { id: '200' }), -1)
  t.is(tweetComparator({ id: '3000' }, { id: '999' }), 1)
  t.is(tweetComparator({ id: '3001' }, { id: '3001' }), 0)

  t.deepEqual(
    [
      { id: '5' },
      { id: '1000' },
      { id: '9999' },
      { id: '5' },
      { id: '15' },
      { id: '500' }
    ].sort(tweetComparator),
    [
      { id: '5' },
      { id: '5' },
      { id: '15' },
      { id: '500' },
      { id: '1000' },
      { id: '9999' }
    ]
  )
})
