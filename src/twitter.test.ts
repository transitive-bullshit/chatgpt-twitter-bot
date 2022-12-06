import test from 'ava'

import { maxTwitterId } from './twitter'

test('maxTwitterId', async (t) => {
  t.is(maxTwitterId('123', '456'), '456')
  t.is(maxTwitterId('1230', '999'), '1230')
  t.is(maxTwitterId('', '999'), '999')
  t.is(maxTwitterId('999', ''), '999')
  t.is(maxTwitterId('', null), null)
  t.is(maxTwitterId('', undefined), null)
  t.is(maxTwitterId('948392', '948392'), '948392')
})
