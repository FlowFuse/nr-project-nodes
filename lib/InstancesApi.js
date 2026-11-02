/**
 * @typedef {Object} LinkTarget
 * @property {string} id - The link id of the target. An instance id or `dev:<deviceId>` for an application owned device
 * @property {string} name - The name of the target
 * @property {'instance'|'device'} type - The type of target
 * @property {string} [applicationId] - The id of the application the target belongs to (not available on older platforms)
 * @property {string} [applicationName] - The name of the application the target belongs to (not available on older platforms)
 */

/**
 * @typedef {Object} InstancesData
 * @property {number} count - The number of targets
 * @property {Array<LinkTarget>} instances - A flat list of all targets
 * @property {Array<{id:string, name:string, instances:Array<{id:string, name:string}>, devices:Array<{id:string, name:string}>}>} applications - The applications in the team and their targets (empty on older platforms)
 * @property {{id:string, applicationId:string}|null} self - Identity of this instance/device as known by the platform (null on older platforms)
 * @property {boolean} supportsApplications - `true` if the platform supports application aware project links
 */

/**
 * Creates an API for fetching instances data from FlowFuse platform
 * This client caches the instances data to minimise successive API calls which
 * can happen when the runtime is started of a full deploy is performed.
 *
 * The application aware `project-link/targets` endpoint is used when available. Older
 * platforms do not have it, in which case the (legacy) team projects endpoint is used.
 * @param {import('got').Got} gotClient - The got client to use for making HTTP requests
 * @param {Object} param1 - Configuration parameters
 * @param {string} param1.forgeURL - The Forge URL
 * @param {string} param1.teamID - The team ID
 * @param {string} param1.token - The authentication token
 * @param {number} param1.DEFAULT_CACHE_AGE - The default cache age for data
 * @param {string} param1.API_VERSION - The API version to use
 * @example
 * const { InstancesApi } = require('./lib/projects');
 * const got = require('got').default;
 * const forgeURL = 'https://example.com/forge';
 * const instancesApi = InstancesApi(got, { forgeURL, teamID: "abcdef", token: "your-token" });
 * instancesApi.getInstances().then(instances => {
 *   console.log('Instances:', instances);
 * })
 */
function InstancesApi (gotClient, { forgeURL, teamID, token, DEFAULT_CACHE_AGE = 30 * 1000, API_VERSION = 'v1' } = {}) {
    const cache = {
        data: null,
        lastUpdated: 0
    }
    let pendingPromise = null

    async function get (url) {
        let res
        try {
            res = await gotClient.get(url, {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                timeout: {
                    request: 4000
                }
            })
        } catch (err) {
            // got throws for non 2xx responses - return the response so it can be inspected
            if (err.response) {
                return err.response
            }
            throw err
        }
        return res
    }

    /**
     * Fetch from the application aware endpoint
     * A 404, or a 200 that is not JSON with an `applications` array, is treated as an older
     * platform. Before FlowFuse 2.8.0, unknown API paths returned 200 + index.html.
     * Any other failure (network error, 5xx etc) is thrown so it is not mistaken for an
     * older platform while FlowFuse is unavailable.
     * @returns {Promise<InstancesData|null>} the data or `null` if the platform does not support it
     */
    async function fetchTargets () {
        const res = await get(`${forgeURL}/api/${API_VERSION}/teams/${teamID}/project-link/targets`)
        if (res.statusCode === 404) {
            return null // older platform
        }
        if (res.statusCode !== 200) {
            throw new Error(`Failed to fetch instances: ${res.statusCode} ${res.statusMessage}`)
        }
        let body
        try {
            body = JSON.parse(res.body)
        } catch (_err) {
            return null // older platform (not JSON)
        }
        if (!body || !Array.isArray(body.applications)) {
            return null // older platform (not the expected shape)
        }
        const applications = body.applications
        const instances = []
        for (const application of applications) {
            const applicationId = application.id
            const applicationName = application.name
            for (const instance of application.instances || []) {
                instances.push({ id: instance.id, name: instance.name, type: 'instance', applicationId, applicationName })
            }
            for (const device of application.devices || []) {
                instances.push({ id: device.id, name: device.name, type: 'device', applicationId, applicationName })
            }
        }
        return {
            count: instances.length,
            instances,
            applications,
            self: body.self || null,
            supportsApplications: true
        }
    }

    /**
     * Fetch from the legacy team projects endpoint
     * @returns {Promise<InstancesData>}
     */
    async function fetchProjects () {
        const res = await get(`${forgeURL}/api/${API_VERSION}/teams/${teamID}/projects`)
        if (res.statusCode !== 200) {
            throw new Error(`Failed to fetch instances: ${res.statusCode} ${res.statusMessage}`)
        }
        const body = JSON.parse(res.body)
        // Normalize to 'instances' if 'projects' is present
        const instances = (body.instances || body.projects || []).map(p => {
            return { id: p.id, name: p.name, type: 'instance' }
        })
        return {
            count: instances.length,
            instances,
            applications: [],
            self: null,
            supportsApplications: false
        }
    }

    async function fetchInstances () {
        cache.data = (await fetchTargets()) || (await fetchProjects())
        cache.lastUpdated = Date.now()
    }
    return {
        /**
         * Fetches the instances for the current team
         * @param {Number} maxAge - The maximum age of the cache before a fresh fetch is performed (default: 30 seconds, set to 0 to always fetch fresh data)
         * @returns {Promise<InstancesData>} - Returns a promise that resolves to the instances data
         */
        async getInstances (maxAge = DEFAULT_CACHE_AGE) {
            const now = Date.now()
            const useCache = maxAge > 0 && cache.data && (now - cache.lastUpdated < maxAge)
            if (useCache) {
                return cache.data
            }
            try {
                if (!pendingPromise) {
                    pendingPromise = fetchInstances()
                }
                await pendingPromise
                return cache.data
            } catch (err) {
                return Promise.reject(err)
            } finally {
                pendingPromise = null
            }
        },
        get instances () {
            return cache.data?.instances || []
        }
    }
}

module.exports = {
    InstancesApi
}
