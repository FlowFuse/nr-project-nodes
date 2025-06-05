// eslint-disable-next-line no-unused-vars
const should = require('should')
const sinon = require('sinon')
const { projects } = require('../../../lib/projects')

describe('projects', function () {
    const forgeURL = 'http://localhost:8000'
    const teamID = 'team123'
    const token = 'test-token'
    let gotClient
    let sandbox

    beforeEach(function () {
        sandbox = sinon.createSandbox()
        gotClient = { get: sandbox.stub() }
    })

    afterEach(function () {
        sandbox.restore()
    })

    it('fetches projects from the API and caches them', async function () {
        const fakeProjects = { count: 2, projects: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }] }
        gotClient.get.resolves({ statusCode: 200, body: JSON.stringify(fakeProjects) })
        const api = projects(gotClient, { forgeURL, teamID, token })
        const result = await api.getProjects(0) // force fetch
        result.should.deepEqual(fakeProjects)
        // Should be cached now
        const cached = await api.getProjects()
        cached.should.deepEqual(fakeProjects)
        gotClient.get.callCount.should.equal(1)
    })

    it('returns only the projects array via projects getter', async function () {
        const fakeProjects = { count: 1, projects: [{ id: '1', name: 'A' }] }
        gotClient.get.resolves({ statusCode: 200, body: JSON.stringify(fakeProjects) })
        const api = projects(gotClient, { forgeURL, teamID, token })
        await api.getProjects(0)
        api.projects.should.deepEqual(fakeProjects.projects)
    })

    it('throws if API returns non-200', async function () {
        gotClient.get.resolves({ statusCode: 500, statusMessage: 'Internal Error', body: '{}' })
        const api = projects(gotClient, { forgeURL, teamID, token })
        await api.getProjects(0).should.be.rejectedWith(/Failed to fetch projects/)
    })

    it('waits for pending fetch if already in progress', async function () {
        const fakeProjects = { count: 1, projects: [{ id: '1', name: 'A' }] }
        let resolve
        const promise = new Promise(_resolve => { resolve = _resolve })
        gotClient.get.returns(promise)
        const api = projects(gotClient, { forgeURL, teamID, token })
        const p1 = api.getProjects()
        const p2 = api.getProjects()
        resolve({ statusCode: 200, body: JSON.stringify(fakeProjects) })
        const [r1, r2] = await Promise.all([p1, p2])
        r1.should.deepEqual(fakeProjects)
        r2.should.deepEqual(fakeProjects)
        gotClient.get.callCount.should.equal(1)
    })

    it('returns empty array from projects getter if not fetched', function () {
        const api = projects(gotClient, { forgeURL, teamID, token })
        api.projects.should.deepEqual([])
    })
})
