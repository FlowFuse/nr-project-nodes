function projects (gotClient, { forgeURL, teamID, token, DEFAULT_PROJECT_CACHE_AGE = 30 * 1000, API_VERSION = 'v1' } = {}) {
    const cache = {
        data: null,
        lastUpdated: 0
    }
    let pendingPromise = null
    async function fetchProjects () {
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
            throw new Error(`Failed to fetch projects: ${res.statusCode} ${res.statusMessage}`)
        }
        cache.data = JSON.parse(res.body)
        cache.lastUpdated = Date.now()
    }
    return {
        /**
         * Fetches the projects for the current team
         * @param {Number} maxAge - The maximum age of the cache before a fresh fetch is performed (default: 30 seconds, set to 0 to always fetch fresh data)
         * @returns {Promise<{count:Number, projects:Array<{id:string, name:string}}>} - Returns a promise that resolves to an array of projects
         */
        async getProjects (maxAge = DEFAULT_PROJECT_CACHE_AGE) {
            const now = Date.now()
            const useCache = maxAge > 0 && cache.data && (now - cache.lastUpdated < maxAge)
            if (useCache) {
                return cache.data
            }
            try {
                if (!pendingPromise) {
                    pendingPromise = fetchProjects()
                }
                await pendingPromise
                return cache.data
            } catch (err) {
                return Promise.reject(err)
            } finally {
                pendingPromise = null
            }
        },
        get projects () {
            return cache.data ? cache.data.projects : []
        }
    }
}

module.exports = {
    projects
}
