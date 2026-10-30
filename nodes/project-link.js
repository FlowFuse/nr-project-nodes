module.exports = function (RED) {
    'use strict'

    // Do not register nodes in runtime if settings not provided
    if (!RED.settings.flowforge || !(RED.settings.flowforge.projectID || RED.settings.flowforge.applicationID) || !RED.settings.flowforge.teamID || !RED.settings.flowforge.projectLink) {
        throw new Error('Project Link nodes cannot be loaded outside of an FlowFuse EE environment')
    }

    // Imports
    const crypto = require('crypto')
    const os = require('os')
    const { default: GOT } = require('got')
    const MQTT = require('mqtt')
    const urlModule = require('url')
    const utils = require('../lib/utils.js')
    const InstancesApi = require('../lib/InstancesApi.js').InstancesApi
    const { isValidSubscriptionTopic, isValidPublishTopic } = require('../lib/topics.js')

    // Constants
    const API_VERSION = 'v1'
    const TOPIC_HEADER = 'ff'
    const TOPIC_VERSION = 'v1'
    const TOPIC_TYPE_TEAM = 'p' // ff/v1/<team>/p/<instance|dev:device>/...
    const TOPIC_TYPE_APPLICATION = 'a' // ff/v1/<team>/a/<application>/p/<instance|dev:device>/out/...
    const SCOPE_TEAM = 'team'
    const SCOPE_APPLICATION = 'application'
    const BROADCAST_APPLICATION = 'application' // project link out `broadcast` value for an application broadcast
    const DEFAULT_PROJECT_CACHE_AGE = 30 * 1000 // 30 seconds
    const INSTANCES_RETRY_MIN = 30 * 1000 // first retry after 30 seconds (+/- jitter)
    const INSTANCES_RETRY_MAX = 5 * 60 * 1000 // back off to 5 minutes (+/- jitter)
    const ERROR_APPLICATION_SCOPE_NOT_SUPPORTED = 'APPLICATION_SCOPE_NOT_SUPPORTED'
    // It is not unreasonable to expect `projectID` and `applicationID` are set for an instance
    // owned device, however an application owned device should not have a projectID.
    // therefore, assume project owned if `projectID` is set
    const OWNER_TYPE = RED.settings.flowforge.projectID ? 'instance' : 'application'
    const featureEnabled = RED.settings.flowforge.projectLink.featureEnabled !== false

    // Generate a unique ID based on the hostname
    // This is then used when in HA/sharedSubscription mode to ensure the instance has
    // a unique clientId that is stable across restarts
    const haInstanceId = crypto.createHash('md5').update(os.hostname()).digest('hex').substring(0, 4)

    // #region JSDoc

    /**
     * An event generated when a link call is executed
     * @typedef {object} MessageEvent
     * @property {string} eventId
     * @property {string} node
     * @property {string} project
     * @property {string} topic
     * @property {number} ts
     */

    /**
     * An array of messageEvent for processing link calls
     * @typedef {Object.<string, MessageEvent>} MessageEvents
     */

    // #endregion JSDoc

    // #region Helpers

    const got = GOT.extend({
        agent: utils.getHTTPProxyAgent(RED.settings.flowforge.forgeURL, { timeout: 4000 })
    })

    const instancesApi = InstancesApi(got, {
        forgeURL: RED.settings.flowforge.forgeURL,
        teamID: RED.settings.flowforge.teamID,
        token: RED.settings.flowforge.projectLink.token,
        API_VERSION,
        DEFAULT_PROJECT_CACHE_AGE
    })

    // The application this instance/device belongs to. Devices are provided this in settings,
    // hosted instances learn it from the platform (see `getInstances`)
    let ownApplicationId = RED.settings.flowforge.applicationID || ''
    // `true` once the platform has confirmed it supports application aware project links
    let supportsApplications = false

    /**
     * Get the instances (and application owned devices) in the team.
     * Also records the application this instance belongs to, if the platform provides it
     * @param {number} [maxAge] - max age of cached data
     */
    async function getInstances (maxAge) {
        const data = await instancesApi.getInstances(maxAge)
        supportsApplications = !!data?.supportsApplications
        if (!ownApplicationId && data?.self?.applicationId) {
            ownApplicationId = data.self.applicationId
        }
        return data
    }

    /**
     * Get the id of the application this instance belongs to.
     * Devices know their application from settings, but the platform must also support
     * application scoped topics, so this always requires `supportsApplications`.
     * If FlowFuse could not be reached, the request error is thrown. If FlowFuse answered but
     * does not support application scope, the error has `code` `APPLICATION_SCOPE_NOT_SUPPORTED`
     * @returns {Promise<string>} the application id
     */
    async function getOwnApplicationId () {
        if (!ownApplicationId || !supportsApplications) {
            await getInstances()
        }
        if (!ownApplicationId || !supportsApplications) {
            const err = new Error('Application scoped messages are not supported by this version of FlowFuse')
            err.code = ERROR_APPLICATION_SCOPE_NOT_SUPPORTED
            throw err
        }
        return ownApplicationId
    }

    // Nodes that need the instances list at startup (to learn the application id, or to check
    // a source/target exists) wait here until FlowFuse answers. One lookup is shared by all
    // waiting nodes. While FlowFuse cannot be reached, it is retried with backoff and jitter,
    // and straight away when the MQTT client connects.
    const instancesWaiters = new Set()
    let instancesLookup = null
    let instancesRetryTimer = null
    let instancesRetryCount = 0

    /**
     * Wait for the instances list
     * @param {object} waiter
     * @param {function(object)} waiter.resolve - called with the instances data
     * @param {function(Error)} waiter.waiting - called each time a lookup fails and will be retried
     * @returns {function} call to stop waiting
     */
    function waitForInstances (waiter) {
        instancesWaiters.add(waiter)
        lookupInstances()
        return function () {
            instancesWaiters.delete(waiter)
            if (!instancesWaiters.size) {
                clearTimeout(instancesRetryTimer)
                instancesRetryTimer = null
                instancesRetryCount = 0
            }
        }
    }

    function lookupInstances () {
        if (instancesLookup || !instancesWaiters.size) {
            return
        }
        clearTimeout(instancesRetryTimer)
        instancesRetryTimer = null
        // clear the in-flight lookup before settling, so a waiter added by a resolve callback starts a new lookup
        instancesLookup = getInstances()
            .finally(() => {
                instancesLookup = null
            })
            .then(data => {
                const waiters = [...instancesWaiters]
                instancesWaiters.clear()
                instancesRetryCount = 0
                waiters.forEach(waiter => waiter.resolve(data))
            }, err => {
                instancesWaiters.forEach(waiter => waiter.waiting(err))
                if (instancesWaiters.size) {
                    const delay = utils.getRetryDelay(instancesRetryCount++, INSTANCES_RETRY_MIN, INSTANCES_RETRY_MAX)
                    instancesRetryTimer = setTimeout(lookupInstances, delay)
                }
            })
    }

    /**
     * Wait for the id of the application this instance belongs to
     * @param {object} waiter
     * @param {function(string)} waiter.resolve - called with the application id
     * @param {function(Error)} waiter.reject - called if FlowFuse does not support application scope
     * @param {function(Error)} waiter.waiting - called each time a lookup fails and will be retried
     * @returns {function} call to stop waiting
     */
    function waitForApplicationId (waiter) {
        return waitForInstances({
            resolve: () => {
                if (!ownApplicationId || !supportsApplications) {
                    const err = new Error('Application scoped messages are not supported by this version of FlowFuse')
                    err.code = ERROR_APPLICATION_SCOPE_NOT_SUPPORTED
                    waiter.reject(err)
                    return
                }
                waiter.resolve(ownApplicationId)
            },
            waiting: waiter.waiting
        })
    }

    /**
     * Check the source/target of a node exists in FlowFuse.
     * If it does not, the node shows `statusText` in red and warns. While FlowFuse cannot be
     * reached, the node warns once, keeps its connection status and the check is retried.
     * @param {object} node - the node to check
     * @param {'source'|'target'} kind - what is being checked (for the warning)
     * @param {string} statusText - the status to show if the check fails
     * @param {function(object):(string|undefined)} check - called with the instances data, returns an error message if the check fails
     * @returns {function} call to stop checking
     */
    function checkTarget (node, kind, statusText, check) {
        let warned = false
        return waitForInstances({
            resolve: data => {
                const error = check(data)
                if (error) {
                    mqtt.deregisterStatus(node) // prevent connections/disconnections from updating the status (this node is in error!)
                    node.status({ fill: 'red', shape: 'dot', text: statusText })
                    node.warn(error)
                }
            },
            waiting: err => {
                if (!warned) {
                    warned = true
                    // connection errors (e.g. ECONNREFUSED to `localhost`) can have an empty message
                    node.warn(`Unable to check ${kind} '${node.project}' with FlowFuse, will keep retrying: ${err.message || err.code || 'unknown error'}`)
                }
            }
        })
    }

    function jsonReplacer (_key, value) {
        const wrapper = (type, data) => { return { type, data } }
        if (typeof value === 'undefined') {
            return wrapper('undefined', '')
        } else if (typeof value === 'bigint') {
            return wrapper('bigint', value.toString())
        } else if (typeof value === 'function') {
            return wrapper('function', value.toString())
        } else if (typeof value === 'object' && value !== null) {
            // NOTE: Map and Set objects that are built in a function VM do NOT
            // evaluate to true when tested for instanceof Map or Set. Instead
            // constructor.name and .entries/.keys properties are used to determine type
            if (value instanceof Map || (value.constructor?.name === 'Map' && value.entries)) {
                return wrapper('Map', [...value])
            } else if (value instanceof Set || (value.constructor?.name === 'Set' && value.values)) {
                return wrapper('Set', [...value])
            } else if (Buffer.isBuffer(value) || (value.constructor?.name === 'Buffer')) {
                return value.toJSON()
            }
        }
        return value
    }

    function jsonReviver (_key, value) {
        if (typeof value === 'object' && value !== null && value.data !== undefined) {
            if (value.type === 'undefined') {
                // return undefined //doesn't work - returning undefined delete the property
                return null // side effect: undefined becomes null
            } else if (value.type === 'Buffer') {
                return Buffer.from(value.data)
            } else if (value.type === 'bigint') {
                return BigInt(value.data)
            } else if (value.type === 'Map') {
                return new Map(value.data)
            } else if (value.type === 'Set') {
                return new Set(value.data)
            } else if (value.type === 'function') {
                // eslint-disable-next-line no-new-func
                return new Function('return ' + value.data)()
            }
        }
        return value
    }

    function parseLinkTopic (topic) {
        // 0  1  2          3 4                                    5  6..
        // ff/v1/7N152GxG2p/p/23d79df8-183c-4104-aa97-8915e1897326/in/a/b       pub proj→prog
        // ff/v1/7N152GxG2p/p/ca65f5ed-aea0-4a10-ac9a-2086b6af6700/out/b1/b1    pub broadcast
        // ff/v1/7N152GxG2p/p/23d79df8-183c-4104-aa97-8915e1897326/in/a/b       sub proj→prog
        // ff/v1/7N152GxG2p/p/+/out/b1/b1                                       sub broadcast
        // ff/v1/7N152GxG2p/a/aBcD3fGh1/p/+/out/b1/b1                           sub application broadcast
        const topicParts = (topic || '').split('/')
        const isApplicationScope = topicParts[3] === TOPIC_TYPE_APPLICATION
        if (isApplicationScope) {
            // remove `a/<application>` so the remaining parts align with a team scoped topic
            topicParts.splice(3, 2)
        }
        const projectOrDevice = topicParts[3] ? (topicParts[3] === 'd' ? 'd' : 'p') : null
        const isBroadcast = topicParts[5] ? topicParts[5] === 'out' : null
        // eslint-disable-next-line no-unused-vars
        const isDirectTarget = topicParts[5] ? topicParts[5] === 'in' : null
        const isCallResponse = topicParts[5] ? topicParts[5].startsWith('res') : null
        const result = {
            topicHeader: topicParts[0],
            topicVersion: topicParts[1],
            teamID: topicParts[2],
            type: projectOrDevice,
            scope: isApplicationScope ? SCOPE_APPLICATION : SCOPE_TEAM,
            applicationID: isApplicationScope ? (topic || '').split('/')[4] : undefined,
            projectID: topicParts[4],
            isBroadcast,
            isCallResponse,
            subTopic: topicParts.slice(6).join('/')
        }
        return result
    }

    /**
     * Build a project link topic
     * @param {object} node - the node the topic is for (`null` for a call response)
     * @param {string} projectOrDeviceId - the target/source instance id or `dev:<deviceId>` (or `all` for a broadcast listener)
     * @param {string} subTopic - the user topic
     * @param {boolean} broadcast - `true` if the topic is a broadcast topic
     * @param {string} [responseTopic] - the response prefix for a call response
     * @param {string} [applicationId] - for broadcast topics, the application to scope the broadcast to
     * @returns {string} the topic
     */
    function buildLinkTopic (node, projectOrDeviceId, subTopic, broadcast, responseTopic, applicationId) {
        // ↓ Useful for debugging ↓
        // console.log(`🔗 buildLinkTopic: for ${OWNER_TYPE} ${node?.ownId || ''} ${projectOrDeviceId} ${subTopic} ${broadcast} ${responseTopic}`)
        const topicParts = [TOPIC_HEADER, TOPIC_VERSION, RED.settings.flowforge.teamID]
        const broadcastType = applicationId ? [TOPIC_TYPE_APPLICATION, applicationId, TOPIC_TYPE_TEAM] : [TOPIC_TYPE_TEAM]
        if (!node || node.type === 'project link call') {
            topicParts.push('p')
            topicParts.push(projectOrDeviceId)
            if (responseTopic) {
                topicParts.push(responseTopic)
            } else {
                topicParts.push('in')
            }
        } else if (node.type === 'project link in') {
            if (broadcast && projectOrDeviceId === 'all') { // Listen for broadcast messages from all projects
                topicParts.push(...broadcastType)
                topicParts.push('+')
                topicParts.push('out')
                // e.g. SUB ff/v1/7N152GxG2p/p/+/out/a/b
                // e.g. SUB ff/v1/7N152GxG2p/a/APP-ID/p/+/out/a/b
            } else if (broadcast) { // Listen for broadcast messages from a specific project
                topicParts.push(...broadcastType)
                topicParts.push(projectOrDeviceId)
                topicParts.push('out')
                // e.g. SUB ff/v1/7N152GxG2p/p/SOURCE-PROJ-ID-aa97-8915e1897326/out/a/b
                // e.g. SUB ff/v1/7N152GxG2p/a/APP-ID/p/dev:<device-id>/out/a/b
            } else { // Receive messages sent to this instance
                topicParts.push('p')
                topicParts.push(node.ownId)
                topicParts.push('in')
                // e.g. SUB ff/v1/7N152GxG2p/p/PROJECT-OWN-ID-aa97-8915e1897326/in/a/b
            }
        } else if (node.type === 'project link out') {
            if (broadcast) {
                // publish to all (broadcast)
                topicParts.push(...broadcastType)
                topicParts.push(node.ownId)
                topicParts.push('out')
                // e.g. PUB topic ff/v1/7N152GxG2p/p/PROJECT-OWN-ID-aa97-8915e1897326/out/a/b
                // e.g. PUB ff/v1/7N152GxG2p/p/dev:<device-id>/out/a/b
                // e.g. PUB ff/v1/7N152GxG2p/a/APP-ID/p/dev:<device-id>/out/a/b
            } else {
                // publish to a specific project
                topicParts.push('p')
                topicParts.push(projectOrDeviceId)
                topicParts.push('in')
                // e.g. PUB ff/v1/7N152GxG2p/p/TARGET-PROJ-ID-aa97-8915e1897326/in/a/b
                // e.g. PUB ff/v1/7N152GxG2p/p/dev:<device-id>/in/a/b
            }
        }
        topicParts.push(subTopic)
        const topic = topicParts.join('/')
        // ↓ Useful for debugging ↓
        // console.log(`🔗 buildLinkTopic created topic: ${topic}`)
        return topic
    }
    // #endregion Helpers

    // mqtt encapsulation
    const mqtt = (function () {
        const allNodes = new Set()
        /** @type {MQTT.MqttClient} The Single MQTT client connection */
        let client
        /** @type {MQTT.MqttClient[]} An array to track and auto kill multiple client connections */
        const clients = []
        let connected = false
        let connecting = false
        let closing = false

        const connAck = {
            /** @type {MQTT.IConnackPacket.properties} */ properties: {},
            /** @type {MQTT.IConnackPacket.reasonCode} */ reasonCode: null,
            /** @type {MQTT.IConnackPacket.returnCode} */ returnCode: null
        }
        /** @type {Map<string,Set<object>>} */
        const topicCallbackMap = new Map()
        // let callback_detail_map = new Map()
        let clientListeners = []

        /**
         *
         * @param {string} topic
         * @param {Buffer} message
         * @param {MQTT.IPublishPacket} packet
         */
        function onMessage (topic, message, packet) {
            // console.log(`RECV ${topic}`)
            const subID = packet.properties?.subscriptionIdentifier
            let lookupTopic = topic
            if (subID === 1) {
                lookupTopic = '1:' + topic
            }
            const directCallbacks = topicCallbackMap.get(lookupTopic) // ff/v1/team-id/p/project-id/in/sub-topic

            let broadcastCallbacks
            let broadcastLookupTopic
            if (subID === 2) {
                const topicParts = (topic || '').split('/')
                // for an application scoped topic, the source is two segments further along
                const sourceIndex = topicParts[3] === TOPIC_TYPE_APPLICATION ? 6 : 4
                if (topicParts[sourceIndex + 1] === 'out') {
                    topicParts[sourceIndex] = '+' // ff/v1/team-id/p/+/out/sub-topic or ff/v1/team-id/a/app-id/p/+/out/sub-topic all sources
                    broadcastLookupTopic = topicParts.join('/')
                    broadcastCallbacks = topicCallbackMap.get('2:' + broadcastLookupTopic)
                }
            }

            if ((!directCallbacks || !directCallbacks.size) && (!broadcastCallbacks || !broadcastCallbacks.size)) {
                return // no callbacks registered for this topic
            }

            // reconstitute the msg from the message
            let err, msg
            try {
                msg = JSON.parse(message.toString(), jsonReviver)
                const linkTopic = parseLinkTopic(topic)
                msg.projectLink = {
                    ...msg.projectLink,
                    instanceId: packet.properties?.userProperties?._projectID || '',
                    projectId: packet.properties?.userProperties?._projectID || '',
                    applicationId: packet.properties?.userProperties?._applicationID || '',
                    topic: linkTopic.subTopic
                }
                if (linkTopic.isBroadcast) {
                    msg.projectLink.scope = linkTopic.scope
                }
                if (packet.properties?.userProperties?._deviceId) {
                    msg.projectLink.deviceId = packet.properties?.userProperties?._deviceId
                    msg.projectLink.deviceName = packet.properties?.userProperties?._deviceName || ''
                    msg.projectLink.deviceType = packet.properties?.userProperties?._deviceType || ''
                }
            } catch (error) {
                err = error
            }

            // call listeners
            directCallbacks && directCallbacks.forEach(cb => {
                cb && cb(err, topic, msg, packet)
            })
            broadcastCallbacks && broadcastCallbacks.forEach(cb => {
                cb && cb(err, topic, msg, packet)
            })
        }
        function onError (err) {
            RED.log.trace(`Project Link nodes connection error: ${err.message}`)
            allNodes.forEach(node => {
                try {
                    node.status({ fill: 'red', shape: 'dot', text: 'error' })
                } catch (err) { /* do nothing */ }
            })
        }
        function onConnect (/** @type {MQTT.IConnackPacket} */ packet) {
            checkAndContain() // check and contain multiple clients
            connAck.properties = packet.properties
            connAck.reasonCode = packet.reasonCode
            connAck.returnCode = packet.returnCode
            connected = true
            connecting = false
            closing = false
            RED.log.info('Project Link nodes connected')
            allNodes.forEach(node => {
                try {
                    node.status({ fill: 'green', shape: 'dot', text: 'connected' })
                } catch (error) { /* do nothing */ }
            })
            // the broker authenticates connections with FlowFuse, so it is likely reachable
            // again: retry any pending instances lookup now rather than wait for the timer
            lookupInstances()
            // Hosted instances are not given their application id in settings. Learn it now so
            // messages sent by any node carry it (`_applicationID`). Best effort: until this
            // completes, messages are sent without it, as they always were.
            if (!ownApplicationId) {
                getInstances().catch(_err => {})
            }
        }
        function onReconnect () {
            RED.log.info('Project Link nodes reconnecting')
            checkAndContain() // check and contain multiple clients
            allNodes.forEach(node => {
                try {
                    node.status({ fill: 'yellow', shape: 'dot', text: 'reconnecting' })
                } catch (error) { /* do nothing */ }
            })
        }
        // Broker Disconnect - V5 event
        function onDisconnect (packet) {
            // Emitted after receiving disconnect packet from broker. MQTT 5.0 feature.
            const rc = (packet && packet.properties && packet.reasonCode) || packet.reasonCode
            const rs = (packet && packet.properties && packet.properties.reasonString) || ''
            // eslint-disable-next-line no-unused-vars
            const details = {
                reasonCode: rc,
                reasonString: rs
            }
            checkAndContain() // check and contain multiple clients
            connected = false
            connecting = false
            closing = false
            RED.log.warn('Project Link nodes disconnected')
            allNodes.forEach(node => {
                try {
                    node.status({ fill: 'red', shape: 'dot', text: 'disconnected' })
                } catch (error) { /* do nothing */ }
            })
        }
        // Register disconnect handlers
        function onClose (err) {
            checkAndContain() // check and contain multiple clients
            if (err instanceof Error) {
                RED.log.trace(`Project link connection closed: ${err.message}`)
                allNodes.forEach(node => {
                    try {
                        node.status({ fill: 'red', shape: 'dot', text: 'error' })
                    } catch (error) { /* do nothing */ }
                })
            }
            if (connected) {
                connected = false
                closing = false
                if (err) {
                    return // status already updated to error above!
                }
                RED.log.info('Project Link nodes connection closed')
                allNodes.forEach(node => {
                    try {
                        node.status({ fill: 'gray', shape: 'dot', text: 'closed' })
                    } catch (error) { /* do nothing */ }
                })
            } else if (connecting) {
                connecting = false
                if (err) {
                    return // status already updated to error above!
                }
                RED.log.trace('Project Link nodes connect failed')
                allNodes.forEach(node => {
                    try {
                        node.status({ fill: 'red', shape: 'dot', text: 'connect failed' })
                    } catch (error) { /* do nothing */ }
                })
            }
        }

        /**
         * Add event handlers to the MQTT.js client and track them so that
         * we do not remove any handlers that the MQTT client uses internally.
         * Use `off` to remove handlers
         * @param {string} event The name of the event
         * @param {function} handler The handler for this event
         */
        const on = function (event, handler) {
            clientListeners.push({ event, handler })
            client.on(event, handler)
        }

        /**
         * Remove event handlers from the MQTT.js client & only the events
         * that we attached in `on`.
         * * If `event` is omitted, then all events matching `handler` are removed
         * * If `handler` is omitted, then all events named `event` are removed
         * * If both parameters are omitted, then all events are removed
         * @param {string} [event] The name of the event (optional)
         * @param {function} [handler] The handler for this event (optional)
         */
        const off = function (event, handler) {
            clientListeners = clientListeners.filter((l) => {
                if (event && event !== l.event) { return true }
                if (handler && handler !== l.handler) { return true }
                client && client.removeListener(l.event, l.handler)
                return false // found and removed, filter out this one
            })
        }

        /**
         * Check all clients and closes any that are NOT the current client (i.e. keeps a max of 1 client open at any time)
         * If the current client is closed/undefined, then any/all connections found in the clients array will be closed
         * Lastly, the clients array is re-synced to contain only the current client (if it exists)
         */
        function checkAndContain () {
            // There should only ever be one client, but due to async nature of
            // user operations, node-red on(...) events, mqtt auto reconnect,
            // network outages and other timing difficulties, it has proven possible to generate multiple clients.
            // Therefore, whenever we create a connection, we add it to the clients array (in the `connect()` function)
            // That way, we can proactively check all clients and close any that are not the current client
            // This is a low cost operation and will only be called when a connect/reconnect/disconnect callback is made
            for (let i = 0; i < clients.length; i++) {
                if (clients[i] && clients[i] !== client) {
                    if (client) {
                        // if we have a client, but this is not it, log the fact we caught a non-current client
                        RED.log.warn('Project link nodes: cleaning up non current client')
                    }
                    try {
                        clients[i].removeAllListeners()
                        clients[i].end(true)
                    } finally {
                        clients[i] = null
                    }
                }
            }
            // re-sync the clients array if required
            clients.length = 0
            if (client) {
                clients.push(client)
            }
        }
        return { // public interface
            subscribe (node, topic, options, callback) {
                if (!isValidSubscriptionTopic(topic)) {
                    return Promise.reject(new Error('Invalid topic'))
                }

                // generate a lookup based on the subscriptionId + : + topic
                let lookupTopic = topic
                // Check for a shared subscription - in which case, need to strip
                // off the $share/<id>/ as the received messages won't have that
                // in their topic
                if (lookupTopic.startsWith('$share')) {
                    lookupTopic = lookupTopic.split('/').slice(2).join('/')
                }
                const subID = [null, 1, 2][node.subscriptionIdentifier]
                if (subID) {
                    lookupTopic = subID + ':' + lookupTopic
                }

                /** @type {Set} */
                let callbacks = topicCallbackMap.get(lookupTopic)
                const topicExists = !!callbacks
                callbacks = callbacks || new Set()
                topicCallbackMap.set(lookupTopic, callbacks)
                callbacks.add(callback)
                if (topicExists) {
                    return Promise.resolve()
                }
                /** @type {MQTT.IClientSubscribeOptions} */
                const subOptions = Object.assign({}, options)
                subOptions.qos = subOptions.qos == null ? 2 : subOptions.qos
                subOptions.properties = Object.assign({}, options.properties)
                subOptions.properties.userProperties = subOptions.properties.userProperties || {}
                subOptions.properties.userProperties._projectID = RED.settings.flowforge.projectID || ''
                subOptions.properties.userProperties._applicationID = ownApplicationId
                if (OWNER_TYPE === 'application') {
                    subOptions.properties.userProperties._deviceID = process.env.FF_DEVICE_ID || ''
                }
                subOptions.properties.userProperties._nodeID = node.id
                subOptions.properties.userProperties._ts = Date.now()
                if (subID) {
                    subOptions.properties.subscriptionIdentifier = subID
                }
                const subscribePromise = function (topic, subOptions) {
                    return new Promise((resolve, reject) => {
                        if (!client) {
                            return reject(new Error('client not initialised')) // if the client is not initialised, cannot subscribe!
                        }
                        try {
                            // console.log(`SUB ${topic}`)
                            client.subscribe(topic, subOptions, (err, granted) => {
                                if (err) {
                                    reject(err)
                                } else if (granted?.some(g => g.qos >= 128)) {
                                    // the broker refused the subscription. This can happen when the
                                    // FlowFuse platform does not support the selected option
                                    reject(new Error('Subscription not permitted by the FlowFuse platform'))
                                } else {
                                    resolve(true)
                                }
                            })
                        } catch (error) {
                            reject(error)
                        }
                    })
                }
                return subscribePromise(topic, subOptions)
            },
            unsubscribe (node, topic, callback) {
                // generate a lookup based on the subscriptionId + : + topic
                let lookupTopic = topic
                // shared subscriptions are registered without the $share/<id>/ prefix (see subscribe)
                if (lookupTopic.startsWith('$share')) {
                    lookupTopic = lookupTopic.split('/').slice(2).join('/')
                }
                const subID = [null, 1, 2][node.subscriptionIdentifier]
                if (subID) {
                    lookupTopic = subID + ':' + lookupTopic
                }
                /** @type {Set} */
                const callbacks = topicCallbackMap.get(lookupTopic)
                if (!callbacks) {
                    return Promise.resolve()
                }
                if (callback) {
                    callbacks.delete(callback) // delete 1
                } else {
                    callbacks.clear() // delete all
                }
                if (callbacks.size === 0) {
                    topicCallbackMap.delete(lookupTopic)
                } else {
                    return Promise.resolve() // callbacks still exist, don't unsubscribe
                }
                const unsubscribePromise = function (topic) {
                    return new Promise((resolve, reject) => {
                        if (!client) {
                            return resolve() // if the client is not initialised, there are no subscriptions!
                        }
                        try {
                            client.unsubscribe(topic)
                            resolve()
                        } catch (error) {
                            reject(error)
                        }
                    })
                }
                return unsubscribePromise(topic)
            },
            publish (node, topic, msg, options) {
                options = options || {}
                if (!isValidPublishTopic(topic)) {
                    throw new Error('Invalid topic')
                }
                /** @type {MQTT.IClientPublishOptions} */
                const pubOptions = Object.assign({}, options)
                pubOptions.qos = pubOptions.qos == null ? 2 : pubOptions.qos
                pubOptions.properties = Object.assign({}, options.properties)
                pubOptions.properties.userProperties = pubOptions.properties.userProperties || {}
                pubOptions.properties.userProperties._projectID = RED.settings.flowforge.projectID || ''
                pubOptions.properties.userProperties._applicationID = ownApplicationId
                if (process.env.FF_DEVICE_ID) {
                    pubOptions.properties.userProperties._deviceId = process.env.FF_DEVICE_ID
                    pubOptions.properties.userProperties._deviceName = process.env.FF_DEVICE_NAME || ''
                    pubOptions.properties.userProperties._deviceType = process.env.FF_DEVICE_TYPE || ''
                }
                pubOptions.properties.userProperties._nodeID = node.id
                pubOptions.properties.userProperties._publishTime = Date.now()
                pubOptions.properties.contentType = 'application/json'
                const publishPromise = function (topic, message, pubOptions) {
                    return new Promise((resolve, reject) => {
                        if (!client) {
                            return reject(new Error('client not initialised')) // if the client is not initialised, cannot publish!
                        }
                        try {
                            client.publish(topic, message, pubOptions, (err, packet) => {
                                if (err) {
                                    reject(err)
                                } else {
                                    resolve(packet)
                                }
                            })
                        } catch (error) {
                            reject(error)
                        }
                    })
                }
                const message = JSON.stringify(msg, jsonReplacer)
                return publishPromise(topic, message, pubOptions)
            },
            connect (options) {
                if (client && (connected || connecting)) {
                    return true
                }
                try {
                    connected = false
                    connecting = true
                    off() // close existing event handlers to be safe from duplicates (re-wired after connection issued)

                    if (client) {
                        // if client is something, force it to end unconditionally
                        RED.log.trace('force end() project node client before new connect')
                        try {
                            client.removeAllListeners()
                            client.end(true)
                        } finally {
                            client = null
                        }
                    }

                    /** @type {MQTT.IClientOptions} */
                    const defaultOptions = {
                        protocolVersion: 5,
                        clean: false,
                        reconnectPeriod: RED.settings.mqttReconnectTime || crypto.randomInt(3000, 7000),
                        properties: {
                            // Allow the broker to keep the session alive for 2 minutes after
                            // a disconnect. This ensures short-connectivity blips do not lead to
                            // inbound message loss.
                            sessionExpiryInterval: 120,
                            requestResponseInformation: true,
                            requestProblemInformation: true,
                            userProperties: {
                                project: RED.settings.flowforge.projectID || '',
                                application: RED.settings.flowforge.applicationID || ''
                            }
                        }
                    }
                    options = Object.assign({}, defaultOptions, options)

                    // ensure keepalive is set (defaults to sub 60s to avoid timeout in load balancer)
                    options.keepalive = options.keepalive || 45

                    if (RED.settings.flowforge.projectLink.broker.clientId) {
                        options.clientId = RED.settings.flowforge.projectLink.broker.clientId
                    } else {
                        // If no clientId specified, use 'username' with ':n' appended.
                        // This ensures uniqueness between this and the launcher/device's own
                        // client connection.
                        options.clientId = RED.settings.flowforge.projectLink.broker.username + ':n'
                        if (RED.settings.flowforge.projectLink.useSharedSubscriptions) {
                            // In HA mode - append the haInstanceId to ensure uniqueness
                            options.clientId += `:${haInstanceId}`
                        }
                    }
                    if (RED.settings.flowforge.projectLink.broker.username) {
                        options.username = RED.settings.flowforge.projectLink.broker.username
                    }
                    if (RED.settings.flowforge.projectLink.broker.password) {
                        options.password = RED.settings.flowforge.projectLink.broker.password
                    }
                    connAck.properties = null
                    connAck.reasonCode = null
                    connAck.returnCode = null

                    connecting = true
                    // PROBLEM: ipv6 ws addresses cannot connect
                    // INFO: Calling mqtt.connect('http://[::1]:8883') fails with error  ERR_INVALID_URL
                    // INFO: Calling mqtt.connect(new URL('http://[::1]:8883')) fails because `connect` only accepts a `string` or `url.parse` object
                    // INFO: Calling mqtt.connect(url.parse('http://[::1]:8883') fails because unlike new URL, url.parse drops the square brackets off hostname
                    //       (mqtt.js disassembles and reassembles the url using hostname + port so `ws://[::1]:8883` becomes `ws://::1:8883`)
                    // INFO: WS src code uses `new URL` so when `mqtt.js` passes the reassembled IP `http://::1:8883`, it fails with error ERR_INVALID_URL
                    // SEE: https://github.com/mqttjs/MQTT.js/issues/1569
                    const brokerURL = RED.settings.flowforge.projectLink.broker.url || 'mqtt://localhost:1883'
                    // eslint-disable-next-line n/no-deprecated-api
                    const parsedURL = urlModule.parse(brokerURL)
                    const newURL = new URL(brokerURL)
                    parsedURL.hostname = newURL.hostname

                    // wsOptions.agent is expected to be an HTTP or HTTPS agent based on the request protocol
                    if (process.env.all_proxy || process.env.http_proxy || process.env.https_proxy) {
                        options.wsOptions = {
                            agent: utils.getWSProxyAgent(brokerURL)
                        }
                    }

                    client = MQTT.connect(parsedURL, options)
                    clients.push(client) // add to clients array for containment and auto cleanup of multiple clients
                    on('connect', onConnect)
                    on('error', onError)
                    on('close', onClose)
                    on('disconnect', onDisconnect)
                    on('reconnect', onReconnect)
                    on('message', onMessage)
                    return true
                } catch (error) {
                    onClose(error)
                }
            },
            disconnect (done) {
                const _callback = function (err) {
                    connecting = false
                    connected = false
                    closing = false
                    if (err) {
                        RED.log.warn(`Project Link nodes disconnect error: ${err.message}`)
                    }
                    // By this point, the client will mostly likely have been ended cleanly
                    // however, there is no harm in forcing it to end here and so far, this
                    // solves the majority of multiple connect/disconnect issues witnessed.
                    if (client) {
                        try {
                            client.removeAllListeners()
                            client.end(true) // force end, most likely already ended (cleanly)
                        } catch (_err) {
                            // do nothing
                        }
                    }
                    done && typeof done === 'function' && done(err)
                }
                if (!client) { return _callback() }
                const waitEnd = (client, ms) => {
                    return new Promise((resolve, reject) => {
                        closing = true
                        if (!client) {
                            resolve()
                        } else {
                            const t = setTimeout(() => {
                                if (!connected) {
                                    resolve()
                                } else {
                                    reject(new Error('timeout waiting for client clean end'))
                                }
                            }, ms)
                            client.end((err) => {
                                clearTimeout(t)
                                if (err) {
                                    reject(err)
                                } else {
                                    resolve()
                                }
                            })
                        }
                    })
                }

                waitEnd(client, 2000).then(() => {
                    _callback()
                }).catch((_e) => {
                    _callback(_e)
                })
            },
            close (done) {
                topicCallbackMap.forEach(callbacks => {
                    callbacks.clear()
                })
                topicCallbackMap.clear()
                allNodes.forEach(n => {
                    allNodes.delete(n)
                })
                mqtt.disconnect((err) => {
                    off()
                    client = null
                    checkAndContain()
                    done(err)
                })
            },
            registerStatus (node) {
                allNodes.add(node)
            },
            deregisterStatus (node) {
                allNodes.delete(node)
            },
            get connected () {
                return client ? connected : false
            },
            get closing () {
                return closing
            },
            get hasSubscriptions () {
                if (topicCallbackMap.size) {
                    for (const set of topicCallbackMap) {
                        if (set.length) {
                            return true
                        }
                    }
                }
                return false
            }
        }
    })()

    // Project Link In Node
    function ProjectLinkInNode (n) {
        RED.nodes.createNode(this, n)
        const node = this
        node.ownId = OWNER_TYPE === 'application' ? 'dev:' + process.env.FF_DEVICE_ID : RED.settings.flowforge.projectID
        node.project = n.project
        node.subTopic = n.topic
        node.broadcast = n.broadcast === true || n.broadcast === 'true'
        node.scope = (node.broadcast && n.scope === SCOPE_APPLICATION) ? SCOPE_APPLICATION : SCOPE_TEAM
        node.subscriptionIdentifier = (node.broadcast && n.project === 'all') ? 2 : 1
        if (node.scope === SCOPE_TEAM) {
            node.topic = buildLinkTopic(node, node.project, node.subTopic, node.broadcast)
        }

        let configOk = true
        if (featureEnabled === false) {
            configOk = false
            node.status({ fill: 'red', shape: 'dot', text: 'feature not available' })
            node.warn('Project Link feature is not available for your current Team.')
        } else {
            mqtt.connect()
            mqtt.registerStatus(node)
            if (mqtt.connected) {
                node.status({ fill: 'green', shape: 'dot', text: 'connected' })
            }
        }

        /** @type {MQTT.OnMessageCallback} */
        const onSub = function (err, topic, msg, _packet) {
            const t = parseLinkTopic(topic)
            // ensure topic matches
            if (node.subTopic !== t.subTopic) {
                node.warn(`Expected topic ${node.subTopic}, received ${t.subTopic}`)
                return
            }
            // check for error in processing the payload+packet → msg
            if (err) {
                node.error(err, msg)
                return
            }
            node.receive(msg)
        }
        // to my inbox
        // * this project in           ff/v1/7N152GxG2p/p/ca65f5ed-aea0-4a10-ac9a-2086b6af6700/in/b1/b1     sub proj→prog
        // * this device in            ff/v1/7N152GxG2p/p/dev:<device-id>/in/b1/b1                          sub proj→dev
        // team broadcasts
        // * specific project out      ff/v1/7N152GxG2p/p/ca65f5ed-aea0-4a10-ac9a-2086b6af6700/out/b1/b1    sub broadcast
        // * +any project/device+ out  ff/v1/7N152GxG2p/p/+/out/b1/b1                                       sub broadcast
        // application broadcasts
        // * specific project out      ff/v1/7N152GxG2p/a/APP-ID/p/ca65f5ed-aea0-4a10-ac9a-2086b6af6700/out/b1/b1
        // * +any project/device+ out  ff/v1/7N152GxG2p/a/APP-ID/p/+/out/b1/b1
        let subscribedTopic = null
        let stopWaitingForApplicationId = null
        let stopCheckingSource = null
        const subscribe = function () {
            subscribedTopic = node.topic
            if (RED.settings.flowforge.projectLink.useSharedSubscriptions) {
                subscribedTopic = `$share/${RED.settings.flowforge.projectID}/${node.topic}`
            }
            // ↓ Useful for debugging ↓
            // console.log(`🔗 LINK-IN SUB ${subscribedTopic}`)
            return mqtt.subscribe(node, subscribedTopic, { qos: 2 }, onSub)
        }
        if (configOk) {
            if (node.scope === SCOPE_APPLICATION) {
                // application scoped topics need the id of this instance's application
                let warned = false
                stopWaitingForApplicationId = waitForApplicationId({
                    resolve: applicationId => {
                        stopWaitingForApplicationId = null
                        if (warned) {
                            // restore the connection status hidden while waiting
                            mqtt.registerStatus(node)
                            node.status(mqtt.connected ? { fill: 'green', shape: 'dot', text: 'connected' } : {})
                        }
                        node.topic = buildLinkTopic(node, node.project, node.subTopic, node.broadcast, null, applicationId)
                        subscribe().catch(err => {
                            node.status({ fill: 'red', shape: 'dot', text: 'subscribe error' })
                            node.error(err)
                        })
                        validateSource()
                    },
                    reject: err => {
                        stopWaitingForApplicationId = null
                        node.status({ fill: 'red', shape: 'dot', text: 'subscribe error' })
                        node.error(err)
                    },
                    waiting: err => {
                        if (!warned) {
                            warned = true
                            mqtt.deregisterStatus(node) // keep the waiting status until the application is known
                            node.status({ fill: 'yellow', shape: 'ring', text: 'waiting for FlowFuse' })
                            // connection errors (e.g. ECONNREFUSED to `localhost`) can have an empty message
                            node.warn(`Unable to get this instance's application from FlowFuse, will keep retrying: ${err.message || err.code || 'unknown error'}`)
                        }
                    }
                })
            } else {
                subscribe()
                    .then(_result => {})
                    .catch(err => {
                        node.status({ fill: 'red', shape: 'dot', text: 'subscribe error' })
                        node.error(err)
                    })
            }

            // check the project exists in the platform when broadcasting messages to a specific project
            // (for application scope this is done once the application is known)
            if (node.scope === SCOPE_TEAM) {
                validateSource()
            }

            this.on('input', function (msg, send, done) {
                send(msg)
                done()
            })
        }
        function validateSource () {
            if (node.broadcast === true && node.project !== 'all') {
                stopCheckingSource = checkTarget(node, 'source', 'invalid source', data => {
                    // Check if the current project exists in the instances list
                    const source = data.instances && data.instances.find(p => p.id === node.project)
                    if (!source) {
                        if (data.supportsApplications) {
                            return `Selected source '${node.project}' not found in FlowFuse. Listening to a specific source only works for instances in this team.`
                        }
                        return `Selected source '${node.project}' not found in FlowFuse. Listening to a specific source only works for hosted instances in this team: to receive from remote instances, listen for broadcasts instead.`
                    }
                    if (node.scope === SCOPE_APPLICATION && data.supportsApplications && source.applicationId !== ownApplicationId) {
                        return `Selected source '${source.name}' is not in this application. Application broadcasts can only be received from instances in the same application.`
                    }
                })
            }
        }
        node.on('close', function (done) {
            if (stopWaitingForApplicationId) {
                stopWaitingForApplicationId()
                stopWaitingForApplicationId = null
            }
            if (stopCheckingSource) {
                stopCheckingSource()
                stopCheckingSource = null
            }
            const unsubscribe = subscribedTopic ? mqtt.unsubscribe(node, subscribedTopic, onSub) : Promise.resolve()
            unsubscribe
                .then(() => {})
                .catch(_err => {})
                .finally(() => {
                    mqtt.deregisterStatus(node)
                    if (!mqtt.hasSubscriptions && !mqtt.closing) {
                        mqtt.close(done)
                    } else {
                        done()
                    }
                })
        })
    }
    RED.nodes.registerType('project link in', ProjectLinkInNode, {
        settings: {
            projectLinkInNode_ownerType: {
                value: OWNER_TYPE,
                exportable: true
            }
        }
    })

    // Project Link Out Node
    function ProjectLinkOutNode (n) {
        RED.nodes.createNode(this, n)
        const node = this
        node.ownId = OWNER_TYPE === 'application' ? 'dev:' + process.env.FF_DEVICE_ID : RED.settings.flowforge.projectID
        node.project = n.project
        node.subTopic = n.topic
        node.mode = n.mode || 'link'
        // application broadcasts are saved as `broadcast: 'application'` so older versions of
        // these nodes (which ignore `scope`) send nothing rather than a team broadcast
        node.broadcast = n.broadcast === true || n.broadcast === 'true' || n.broadcast === BROADCAST_APPLICATION
        node.scope = (node.broadcast && (n.scope === SCOPE_APPLICATION || n.broadcast === BROADCAST_APPLICATION)) ? SCOPE_APPLICATION : SCOPE_TEAM
        if (featureEnabled === false) {
            node.status({ fill: 'red', shape: 'dot', text: 'feature not available' })
            node.warn('Project Link feature is not available for your current Team.')
        } else {
            mqtt.connect()
            mqtt.registerStatus(node)
            if (mqtt.connected) {
                node.status({ fill: 'green', shape: 'dot', text: 'connected' })
            }
        }

        // When the out node is set to link mode and is targeting a specific project,
        // we should check the target exists in the platform
        let stopCheckingTarget = null
        if (node.mode === 'link' && node.broadcast === false) {
            stopCheckingTarget = checkTarget(node, 'target', 'invalid target', data => {
                // Check if the current project exists in the instances list
                const projectExists = data.instances && data.instances.some(p => p.id === node.project)
                if (!projectExists) {
                    if (data.supportsApplications) {
                        return `Selected target '${node.project}' not found in FlowFuse. Sending to a specific target only works for instances in this team.`
                    }
                    return `Selected target '${node.project}' not found in FlowFuse. Sending to a specific target only works for hosted instances in this team: to reach remote instances, broadcast on a topic instead.`
                }
            })
        }

        node.on('input', async function (msg, _send, done) {
            if (featureEnabled === false) {
                done()
                return
            }
            try {
                if (node.mode === 'return') {
                    if (msg.projectLink?.callStack?.length > 0) {
                        /** @type {MessageEvent} */
                        const messageEvent = msg.projectLink.callStack.pop()
                        const targetId = messageEvent.project || `dev:${messageEvent.device}`
                        if (messageEvent && targetId && messageEvent.topic && messageEvent.eventId) {
                            const responseTopic = buildLinkTopic(null, targetId, messageEvent.topic, node.broadcast, messageEvent.response || 'res')
                            const properties = {
                                correlationData: messageEvent.eventId
                            }
                            // ↓ Useful for debugging ↓
                            // console.log(`🔗 LINK-OUT RETURN PUB ${responseTopic}`)
                            await mqtt.publish(node, responseTopic, msg, { properties })
                        } else {
                            node.warn('Project Link Source not valid')
                        }
                    } else {
                        node.warn('Project Link Source missing')
                    }
                    done()
                } else if (node.mode === 'link') {
                    const applicationId = node.scope === SCOPE_APPLICATION ? await getOwnApplicationId() : null
                    const topic = buildLinkTopic(node, node.project, node.subTopic, node.broadcast, null, applicationId)
                    // ↓ Useful for debugging ↓
                    // console.log(`🔗 LINK-OUT PUB ${topic}`)
                    await mqtt.publish(node, topic, msg)
                    done()
                }
            } catch (error) {
                done(error)
            }
        })
        node.on('close', function (done) {
            if (stopCheckingTarget) {
                stopCheckingTarget()
                stopCheckingTarget = null
            }
            try {
                if (!mqtt.hasSubscriptions && !mqtt.closing) {
                    mqtt.close(done)
                } else {
                    done()
                }
            } finally {
                mqtt.deregisterStatus(node)
            }
        })
    }
    RED.nodes.registerType('project link out', ProjectLinkOutNode)

    // Project Link Call Node
    function ProjectLinkCallNode (n) {
        RED.nodes.createNode(this, n)
        const node = this
        node.ownId = OWNER_TYPE === 'application' ? 'dev:' + process.env.FF_DEVICE_ID : RED.settings.flowforge.projectID
        node.project = n.project
        node.subTopic = n.topic
        node.topic = buildLinkTopic(node, node.project, node.subTopic, false)

        if (RED.settings.flowforge.projectLink.useSharedSubscriptions) {
            node.responseTopicPrefix = `res-${crypto.randomBytes(4).toString('hex')}`
        } else {
            node.responseTopicPrefix = 'res'
        }
        node.responseTopic = buildLinkTopic(node, node.ownId, node.subTopic, false, node.responseTopicPrefix)
        // node.responseTopic = buildLinkTopic(node, RED.settings.flowforge.projectID, node.subTopic, false, node.responseTopicPrefix)
        let timeout = parseFloat(n.timeout || '30') * 1000
        if (isNaN(timeout)) {
            timeout = 30000
        }
        /** @type {MessageEvents} */
        const messageEvents = {}
        let stopCheckingTarget = null

        function onSub (err, topic, msg, packet) {
            const t = parseLinkTopic(topic)
            // ensure topic matches
            if (node.subTopic !== t.subTopic) {
                return
            }
            // check for error in processing the payload+packet → msg
            if (err) {
                node.error(err, msg)
                return
            }
            const eventId = packet.properties && packet.properties.correlationData.toString()
            if (messageEvents[eventId]) {
                node.returnLinkMessage(eventId, msg)
            }
        }
        if (featureEnabled === false) {
            node.status({ fill: 'red', shape: 'dot', text: 'feature not available' })
            node.warn('Project Link feature is not available for your current Team.')
        } else {
            mqtt.connect()
            mqtt.registerStatus(node)
            if (mqtt.connected) {
                node.status({ fill: 'green', shape: 'dot', text: 'connected' })
            }
            // ↓ Useful for debugging ↓
            // console.log(`🔗 LINK-CALL responseTopic SUB ${node.responseTopic}`)
            mqtt.subscribe(node, node.responseTopic, { qos: 2 }, onSub)
                .then(_result => {})
                .catch(err => {
                    node.status({ fill: 'red', shape: 'dot', text: 'subscribe error' })
                    node.error(err)
                })

            stopCheckingTarget = checkTarget(node, 'target', 'invalid target', data => {
                // Check if the current project exists in the instances list
                const target = data.instances && data.instances.find(p => p.id === node.project)
                node.targetName = target?.name
                if (!target) {
                    if (data.supportsApplications) {
                        return `Selected target '${node.project}' not found in FlowFuse. A call can only target an instance in this team.`
                    }
                    return `Selected target '${node.project}' not found in FlowFuse. A call can only target a hosted instance in this team: a remote instance can make calls, but cannot receive them.`
                }
            })
        }

        node.on('input', async function (msg, send, done) {
            try {
                if (featureEnabled === false) {
                    done()
                    return
                }
                const eventId = crypto.randomBytes(14).toString('hex')
                /** @type {MessageEvent} */
                const messageEvent = {
                    eventId,
                    node: node.id,
                    project: RED.settings.flowforge.projectID,
                    instance: RED.settings.flowforge.instanceID,
                    application: ownApplicationId,
                    topic: node.subTopic,
                    response: node.responseTopicPrefix,
                    ts: Date.now()
                }
                if (process.env.FF_DEVICE_ID) {
                    messageEvent.device = process.env.FF_DEVICE_ID
                }
                /** @type {MessageEvents} */
                messageEvents[eventId] = {
                    ...messageEvent,
                    msg: RED.util.cloneMessage(msg),
                    topic: node.topic,
                    responseTopic: node.responseTopic,
                    send,
                    done,
                    timeout: setTimeout(function () {
                        timeoutMessage(eventId)
                    }, timeout)
                }
                if (!msg.projectLink) {
                    msg.projectLink = {
                        callStack: []
                    }
                }
                msg.projectLink.callStack = msg.projectLink.callStack || []
                msg.projectLink.callStack.push(messageEvent)

                if (msg.res?._res?.constructor?.name === 'ServerResponse' && msg.req?.constructor?.name === 'IncomingMessage') {
                    // this msg is a HTTP IncomingMessage object - strip out the circular references
                    delete msg.req
                    delete msg.res
                    msg.res = `RES:${eventId}` // this is a special temporary value that will be cross-checked and the original value restored in returnLinkMessage
                    msg.req = `REQ:${eventId}` // this is a special temporary value that will be cross-checked and the original value restored in returnLinkMessage
                }

                const options = {
                    properties: {
                        correlationData: eventId
                    }
                }
                // ↓ Useful for debugging ↓
                // console.log(`🔗 LINK-CALL PUB ${node.topic}`)
                await mqtt.publish(node, node.topic, msg, options)
            } catch (error) {
                done(error)
            }
        })

        node.on('close', function (done) {
            if (stopCheckingTarget) {
                stopCheckingTarget()
                stopCheckingTarget = null
            }
            mqtt.unsubscribe(node, node.responseTopic)
                .then(() => {})
                .catch(_err => {})
                .finally(() => {
                    mqtt.deregisterStatus(node)
                    if (!mqtt.hasSubscriptions && !mqtt.closing) {
                        mqtt.close(done)
                    } else {
                        done()
                    }
                })
        })

        node.returnLinkMessage = function (eventId, msg) {
            try {
                if (msg.projectLink?.callStack?.length === 0) {
                    delete msg.projectLink.callStack
                }
                const messageEvent = messageEvents[eventId]
                if (messageEvent) {
                    if (msg.res === `RES:${eventId}` && msg.req === `REQ:${eventId}`) {
                        // this msg is a HTTP In msg & its req/res was temporarily detached for transmission over
                        // the link - reattach the original req/res
                        msg.req = messageEvent.msg.req
                        msg.res = messageEvent.msg.res
                    }
                    messageEvent.send(msg)
                    clearTimeout(messageEvent.timeout)
                    delete messageEvents[eventId]
                    messageEvent.done()
                } else {
                    node.send(msg)
                }
            } catch (error) {
                node.error(error, msg)
            }
        }

        function timeoutMessage (eventId) {
            const messageEvent = messageEvents[eventId]
            if (messageEvent) {
                delete messageEvents[eventId]
                const seconds = Math.round(timeout / 100) / 10
                const target = node.targetName ? `'${node.targetName}'` : `instance ${node.project}`
                node.error(`timeout after ${seconds}s waiting for a response from ${target} on topic '${node.subTopic}'. Check that the target instance is running and has a 'project link in' node listening on that topic.`, messageEvent.msg)
            }
        }
    }
    RED.nodes.registerType('project link call', ProjectLinkCallNode)

    // Endpoint for querying list of projects in node UI
    RED.httpAdmin.get('/nr-project-link/projects', RED.auth.needsPermission('flows.write'), async function (_req, res) {
        try {
            const list = await getInstances(0) // get fresh list of projects
            // ↓ Useful for debugging ↓
            // console.log(`🔗 LINK-PROJECTS LIST ${list.count} projects`)
            res.json({
                ...list,
                ownId: OWNER_TYPE === 'application' ? 'dev:' + process.env.FF_DEVICE_ID : RED.settings.flowforge.projectID,
                ownApplicationId
            })
        } catch (err) {
            res.sendStatus(500)
        }
    })
}
