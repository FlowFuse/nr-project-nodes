const proxyFromEnv = require('proxy-from-env')

module.exports = {
    getWSProxyAgent,
    getHTTPProxyAgent
}

/**
 * Get a specific proxy agent for a WebSocket connection. This should be applied to the `wsOptions.agent` property
 *
 * NOTE: This utility function is specifically designed for the MQTT instances where the proxy is set based on the http based EndPoint
 *       that the instance will use to make a connection. As such, the proxy URL is determined based on the `wsEndPoint` provided in
 *       conjunction with env vars `http_proxy`, `https_proxy` and `no_proxy`.
 *
 * More Info:
 *   `wsOptions.agent` is expected to be an HTTP or HTTPS agent based on the request protocol
 *   http/ws requests use env var `http_proxy` and the HttpProxyAgent
 *   https/wss requests use env var `https_proxy` and the HttpsProxyAgent
 *   REF: https://github.com/TooTallNate/proxy-agents/tree/main/packages/proxy-agent#maps-proxy-protocols-to-httpagent-implementations
 *
 * @param {String} url - WebSocket url
 * @param {import('http').AgentOptions} proxyOptions - proxy options
 * @returns {import('https-proxy-agent').HttpsProxyAgent | import('http-proxy-agent').HttpProxyAgent | null}
 */
function getWSProxyAgent (url, proxyOptions) {
    if (!url) {
        return null
    }
    const _url = new URL(url)
    const isHTTPBased = _url.protocol === 'ws:' || _url.protocol === 'http:'
    const isHTTPSBased = _url.protocol === 'wss:' || _url.protocol === 'https:'
    if (!isHTTPBased && !isHTTPSBased) {
        return null
    }

    // replace ^ws with http so that getProxyForUrl can return the correct http*_proxy for ws/wss
    const proxyUrl = proxyFromEnv.getProxyForUrl(url.replace(/^ws/, 'http'))

    if (proxyUrl && isHTTPSBased) {
        const HttpsAgent = require('https-proxy-agent').HttpsProxyAgent
        return new HttpsAgent(proxyUrl, proxyOptions)
    }
    if (proxyUrl && isHTTPBased) {
        const HttpAgent = require('http-proxy-agent').HttpProxyAgent
        return new HttpAgent(proxyUrl, proxyOptions)
    }
    return null
}

/**
 * Get proxy agent for HTTP or HTTPS got instance. This should be applied to the `agent` property of the got instance options
 *
 * NOTE: This utility function is specifically designed for the GOT instances where the proxy is set based on the `httpEndPoint`
 *       that the instance will use to make requests. As such, the proxy URL is determined based on the `httpEndPoint` provided
 *       in conjunction with env vars `http_proxy`, `https_proxy` and `no_proxy`.
 * @param {String} url - http or https URL
 * @param {import('http').AgentOptions} proxyOptions - proxy options
 * @returns {{http: import('http-proxy-agent').HttpProxyAgent | undefined, https: import('https-proxy-agent').HttpsProxyAgent | undefined}}
 */
function getHTTPProxyAgent (url, proxyOptions) {
    const agent = {}
    if (url) {
        const _url = new URL(url)
        const proxyUrl = proxyFromEnv.getProxyForUrl(url)
        if (proxyUrl && _url.protocol === 'http:') {
            const HttpAgent = require('http-proxy-agent').HttpProxyAgent
            agent.http = new HttpAgent(proxyUrl, proxyOptions)
        }
        if (proxyUrl && _url.protocol === 'https:') {
            const HttpsAgent = require('https-proxy-agent').HttpsProxyAgent
            agent.https = new HttpsAgent(proxyUrl, proxyOptions)
        }
    }
    return agent
}
