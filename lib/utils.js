module.exports = {
    getWSProxyAgent,
    getHTTPProxyAgent
}

/**
 * Get a specific proxy agent for a WebSocket connection. This should be applied to the `wsOptions.agent` property
 *
 * NOTE: if the WebSocket endpoint is wss:// and there is an https_proxy set, it will return an HttpsProxyAgent
 *       if the WebSocket endpoint is ws:// and there is an http_proxy set, it will return an HttpProxyAgent
 *       otherwise it will return null
 *
 * More Info:
 *   wsOptions.agent is expected to be an HTTP or HTTPS agent based on the request protocol
 *   http/ws requests use env var http_proxy and the HttpProxyAgent
 *   https/wss requests use env var https_proxy and the HttpsProxyAgent
 *   REF: https://github.com/TooTallNate/proxy-agents/tree/main/packages/proxy-agent#maps-proxy-protocols-to-httpagent-implementations
 *
 * @param {String} wsEndPoint - WebSocket endpoint
 * @param {import('http').AgentOptions} proxyOptions - proxy options
 * @returns {import('https-proxy-agent').HttpsProxyAgent | import('http-proxy-agent').HttpProxyAgent | null}
 */
function getWSProxyAgent (wsEndPoint, proxyOptions) {
    const _url = new URL(wsEndPoint)
    if (process.env.https_proxy && _url.protocol === 'wss:') {
        const HttpsAgent = require('https-proxy-agent').HttpsProxyAgent
        return new HttpsAgent(process.env.https_proxy, proxyOptions)
    }
    if (process.env.http_proxy && _url.protocol === 'ws:') {
        const HttpAgent = require('http-proxy-agent').HttpProxyAgent
        return new HttpAgent(process.env.http_proxy, proxyOptions)
    }
    return null
}

/**
 * Get proxy agents for HTTP and/or HTTPS connections
 * @param {import('http').AgentOptions} proxyOptions - proxy options
 * @returns {{http: import('http-proxy-agent').HttpProxyAgent | undefined, https: import('https-proxy-agent').HttpsProxyAgent | undefined}}
 */
function getHTTPProxyAgent (proxyOptions) {
    const agent = {}
    if (process.env.http_proxy) {
        const HttpAgent = require('http-proxy-agent').HttpProxyAgent
        agent.http = new HttpAgent(process.env.http_proxy, proxyOptions)
    }
    if (process.env.https_proxy) {
        const HttpsAgent = require('https-proxy-agent').HttpsProxyAgent
        agent.https = new HttpsAgent(process.env.https_proxy, proxyOptions)
    }
    return agent
}
