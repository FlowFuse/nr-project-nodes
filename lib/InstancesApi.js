/**
 * Creates an API for fetching instances data from FlowFuse platform
 * This client caches the instances data to minimise successive API calls which
 * can happen when the runtime is started of a full deploy is performed.
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
    async function fetchInstances () {
        const url = `${forgeURL}/api/${API_VERSION}/teams/${teamID}/projects`
        const res = await gotClient.get(url, {
            headers: {
                Authorization: `Bearer ${token}`
            },
            timeout: {
                request: 4000
            }
        })
        if (res.statusCode !== 200) {
            throw new Error(`Failed to fetch instances: ${res.statusCode} ${res.statusMessage}`)
        }
        cache.data = JSON.parse(res.body)
        // Normalize to 'instances' if 'projects' is present
        if (Object.hasOwn(cache.data, 'projects')) {
            cache.data.instances = cache.data.instances || cache.data.projects
            delete cache.data.projects
        }
        cache.lastUpdated = Date.now()
    }
    return {
        /**
         * Fetches the instances for the current team
         * @param {Number} maxAge - The maximum age of the cache before a fresh fetch is performed (default: 30 seconds, set to 0 to always fetch fresh data)
         * @returns {Promise<{count:Number, instances:Array<{id:string, name:string}}>} - Returns a promise that resolves to an array of instances
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
