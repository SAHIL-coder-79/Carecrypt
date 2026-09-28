import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { skipReason, startServer, PASSWORD, USERS } from './helpers.js'

const skip = await skipReason()

describe('reference data API', { skip }, () => {
  let server
  let api
  let clinicianToken

  before(async () => {
    server = await startServer()
    api = server.api

    const loginResponse = await api.login(USERS.CLINICIAN, PASSWORD)
    assert.equal(loginResponse.status, 200)

    clinicianToken = (await loginResponse.json()).token
  })

  after(async () => {
    await server?.close()
  })

  test('no token → 401', async () => {
    const res = await api.get('/api/reference')
    assert.equal(res.status, 401)
  })

  test('CLINICIAN can access reference data', async () => {
    const res = await api.get('/api/reference', clinicianToken)

    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'private, max-age=300')

    const body = await res.json()

    assert.ok(Array.isArray(body.symptoms))
    assert.ok(Array.isArray(body.conditions))
    assert.ok(Array.isArray(body.medications))
  })
})