// eslint-disable-next-line no-unused-vars
const should = require('should')
const sinon = require('sinon')
const { InstancesApi } = require('../../../lib/InstancesApi')

describe('instances API', function () {
    const forgeURL = 'http://localhost:8000'
    const teamID = 'team123'
    const token = 'test-token'
    const targetsURL = `${forgeURL}/api/v1/teams/${teamID}/project-link/targets`
    const projectsURL = `${forgeURL}/api/v1/teams/${teamID}/projects`
    let gotClient
    let sandbox

    function notFound () {
        const err = new Error('Response code 404 (Not Found)')
        err.response = { statusCode: 404, statusMessage: 'Not Found', body: '{}' }
        return err
    }

    beforeEach(function () {
        sandbox = sinon.createSandbox()
        gotClient = { get: sandbox.stub() }
    })

    afterEach(function () {
        sandbox.restore()
    })

    describe('application aware platform', function () {
        const fakeTargets = {
            self: { id: '1', applicationId: 'app1' },
            applications: [
                { id: 'app1', name: 'App 1', instances: [{ id: '1', name: 'A' }], devices: [{ id: 'dev:d1', name: 'Device 1' }] },
                { id: 'app2', name: 'App 2', instances: [{ id: '2', name: 'B' }], devices: [] }
            ]
        }

        it('fetches targets and flattens them into instances', async function () {
            gotClient.get.withArgs(targetsURL).resolves({ statusCode: 200, body: JSON.stringify(fakeTargets) })
            const api = InstancesApi(gotClient, { forgeURL, teamID, token })
            const result = await api.getInstances(0)
            result.should.have.property('supportsApplications', true)
            result.should.have.property('self', fakeTargets.self)
            result.should.have.property('applications', fakeTargets.applications)
            result.should.have.property('count', 3)
            result.instances.should.deepEqual([
                { id: '1', name: 'A', type: 'instance', applicationId: 'app1', applicationName: 'App 1' },
                { id: 'dev:d1', name: 'Device 1', type: 'device', applicationId: 'app1', applicationName: 'App 1' },
                { id: '2', name: 'B', type: 'instance', applicationId: 'app2', applicationName: 'App 2' }
            ])
            gotClient.get.callCount.should.equal(1)
        })

        it('caches the data', async function () {
            gotClient.get.withArgs(targetsURL).resolves({ statusCode: 200, body: JSON.stringify(fakeTargets) })
            const api = InstancesApi(gotClient, { forgeURL, teamID, token })
            const result = await api.getInstances(0)
            const cached = await api.getInstances()
            cached.should.equal(result)
            gotClient.get.callCount.should.equal(1)
        })

        it('waits for pending fetch if already in progress', async function () {
            let resolve
            const promise = new Promise(_resolve => { resolve = _resolve })
            gotClient.get.withArgs(targetsURL).returns(promise)
            const api = InstancesApi(gotClient, { forgeURL, teamID, token })
            const p1 = api.getInstances()
            const p2 = api.getInstances()
            resolve({ statusCode: 200, body: JSON.stringify(fakeTargets) })
            const [r1, r2] = await Promise.all([p1, p2])
            r1.should.equal(r2)
            r1.should.have.property('count', 3)
            gotClient.get.callCount.should.equal(1)
        })
    })

    describe('older platform', function () {
        const fakeProjects = { count: 2, projects: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }] }

        // FlowFuse < 2.8.0 returned 200 + index.html for unknown API paths
        const unsupportedResponses = {
            'a 404': { statusCode: 404, statusMessage: 'Not Found', body: '{}' },
            'an html page': { statusCode: 200, body: '<!DOCTYPE html><html></html>' },
            'json without applications': { statusCode: 200, body: JSON.stringify({ instances: [] }) }
        }
        for (const [name, response] of Object.entries(unsupportedResponses)) {
            it(`falls back to the team projects endpoint when targets returns ${name}`, async function () {
                gotClient.get.withArgs(targetsURL).resolves(response)
                gotClient.get.withArgs(projectsURL).resolves({ statusCode: 200, body: JSON.stringify(fakeProjects) })
                const api = InstancesApi(gotClient, { forgeURL, teamID, token })
                const result = await api.getInstances(0)
                result.should.have.property('supportsApplications', false)
                result.should.have.property('count', 2)
                gotClient.get.callCount.should.equal(2)
            })
        }

        it('falls back to the team projects endpoint', async function () {
            gotClient.get.withArgs(targetsURL).rejects(notFound())
            gotClient.get.withArgs(projectsURL).resolves({ statusCode: 200, body: JSON.stringify(fakeProjects) })
            const api = InstancesApi(gotClient, { forgeURL, teamID, token })
            const result = await api.getInstances(0)
            result.should.deepEqual({
                count: 2,
                instances: [{ id: '1', name: 'A', type: 'instance' }, { id: '2', name: 'B', type: 'instance' }],
                applications: [],
                self: null,
                supportsApplications: false
            })
            gotClient.get.callCount.should.equal(2)
        })

        it('throws without falling back if targets fails with a server error', async function () {
            gotClient.get.withArgs(targetsURL).resolves({ statusCode: 503, statusMessage: 'Service Unavailable', body: '' })
            gotClient.get.withArgs(projectsURL).resolves({ statusCode: 200, body: JSON.stringify(fakeProjects) })
            const api = InstancesApi(gotClient, { forgeURL, teamID, token })
            await api.getInstances(0).should.be.rejectedWith(/Failed to fetch instances: 503/)
            gotClient.get.callCount.should.equal(1)
        })

        it('throws without falling back if targets fails with a network error', async function () {
            gotClient.get.withArgs(targetsURL).rejects(new Error('connect ECONNREFUSED'))
            const api = InstancesApi(gotClient, { forgeURL, teamID, token })
            await api.getInstances(0).should.be.rejectedWith(/ECONNREFUSED/)
            gotClient.get.callCount.should.equal(1)
        })

        it('throws if the team projects endpoint returns non-200', async function () {
            gotClient.get.withArgs(targetsURL).rejects(notFound())
            gotClient.get.withArgs(projectsURL).resolves({ statusCode: 500, statusMessage: 'Internal Error', body: '{}' })
            const api = InstancesApi(gotClient, { forgeURL, teamID, token })
            await api.getInstances(0).should.be.rejectedWith(/Failed to fetch instances/)
        })
    })

    it('returns only the instances array via instances getter', async function () {
        const fakeProjects = { count: 1, projects: [{ id: '1', name: 'A' }] }
        gotClient.get.withArgs(targetsURL).rejects(notFound())
        gotClient.get.withArgs(projectsURL).resolves({ statusCode: 200, body: JSON.stringify(fakeProjects) })
        const api = InstancesApi(gotClient, { forgeURL, teamID, token })
        await api.getInstances(0)
        api.instances.should.deepEqual([{ id: '1', name: 'A', type: 'instance' }])
    })

    it('returns empty array from instances getter if not fetched', function () {
        const api = InstancesApi(gotClient, { forgeURL, teamID, token })
        api.instances.should.deepEqual([])
    })
})
