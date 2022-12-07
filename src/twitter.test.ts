import test from 'ava'

import { maxTwitterId, minTwitterId } from './twitter'

test('maxTwitterId', async (t) => {
  t.is(maxTwitterId('123', '456'), '456')
  t.is(maxTwitterId('1230', '999'), '1230')
  t.is(maxTwitterId('', '999'), '999')
  t.is(maxTwitterId('999', ''), '999')
  t.is(maxTwitterId('', null), null)
  t.is(maxTwitterId('', undefined), null)
  t.is(maxTwitterId('948392', '948392'), '948392')
})

test('minTwitterId', async (t) => {
  t.is(minTwitterId('123', '456'), '123')
  t.is(minTwitterId('1230', '999'), '999')
  t.is(minTwitterId('', '999'), '999')
  t.is(minTwitterId('999', ''), '999')
  t.is(minTwitterId('', null), null)
  t.is(minTwitterId('', undefined), null)
  t.is(minTwitterId('948392', '948392'), '948392')
})
