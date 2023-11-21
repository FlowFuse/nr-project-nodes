module.exports = function (RED) {
    'use strict'

    // Do not register nodes in runtime if settings not provided
    if (!RED.settings.flowforge || !(RED.settings.flowforge.projectID || RED.settings.flowforge.applicationID) || !RED.settings.flowforge.teamID || !RED.settings.flowforge.projectLink) {
        throw new Error('Project Link nodes cannot be loaded outside of an FlowFuse EE environment')
    }

    // Imports
    const crypto = require('crypto')
    const got = require('got')
    const MQTT = require('mqtt')
    const urlModule = require('url')

    // Constants
    const API_VERSION = 'v1'
    const TOPIC_HEADER = 'ff'
    const TOPIC_VERSION = 'v1'
    const OWNER_TYPE = RED.settings.flowforge.applicationID ? 'application' : 'instance'
    const OWNER_ID = OWNER_TYPE === 'application' ? 'app:' + RED.settings.flowforge.applicationID : RED.settings.flowforge.projectID

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

    /**
     * Opinionated test to check topic is valid for subscription...
     * * May start with $share/<group>/
     * * Must not contain  `<space>` `+` `#` `$` `\` `\b` `\f` `\n` `\r` `\t` `\v`
     * * Permits `+` character at index 4 (project name)
     * * Must have at least 1 character between slashes
     * * Must not start or end with a slash
     * @param {string} topic
     * @returns `true` if it is a valid sub topic
     */
    function isValidSubscriptionTopic (topic) {
        return /^(?:\$share\/[^/$+#\b\f\n\r\t\v\0\s]+\/)?(?:[^/$+#\b\f\n\r\t\v\0\s]+\/){4}(?:\+|[^/$+#\b\f\n\r\t\v\0\s]+)(?:\/(?:[^/$+#\b\f\n\r\t\v\0\s]+?)){2,}$/.test(topic)
    }

    /**
     * Opinionated test to check topic is valid for publishing...
     * * Must not contain  `<space>` `+` `#` `$` `\` `\b` `\f` `\n` `\r` `\t` `\v`
     * * Must have at least 1 character between slashes
     * * Must not start or end with a slash
     * @param {string} topic
     * @returns `true` if it is a valid sub topic
     */
    function isValidPublishTopic (topic) {
        return /^(?:[^/$+#\b\f\n\r\t\v\0]+\/){4}(?:[^/$+#\b\f\n\r\t\v\0]+)(?:\/(?:[^/$+#\b\f\n\r\t\v\0]+?)){2,}$/.test(topic)
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
        const topicParts = (topic || '').split('/')
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
            projectID: topicParts[4],
            isBroadcast,
            isCallResponse,
            subTopic: topicParts.slice(6).join('/')
        }
        return result
    }

    function buildLinkTopic (node, projectOrAppID, subTopic, broadcast, responseTopic) {
        const topicParts = [TOPIC_HEADER, TOPIC_VERSION, RED.settings.flowforge.teamID]
        if (!node || node.type === 'project link call') {
            topicParts.push('p')
            topicParts.push(projectOrAppID)
            if (responseTopic) {
                topicParts.push(responseTopic)
            } else {
                topicParts.push('in')
            }
        } else if (node.type === 'project link in') {
            topicParts.push('p')
            if (broadcast && projectOrAppID === 'all') { // Listen for broadcast messages from all projects
                topicParts.push('+')
                topicParts.push('out')
                // e.g. SUB ff/v1/7N152GxG2p/p/+/out/a/b
            } else if (broadcast) { // Listen for broadcast messages from a specific project
                topicParts.push(projectOrAppID)
                topicParts.push('out')
                // e.g. SUB ff/v1/7N152GxG2p/p/SOURCE-PROJ-ID-aa97-8915e1897326/out/a/b
            } else { // Receive messages sent to this instance
                topicParts.push(OWNER_ID)
                topicParts.push('in')
                // e.g. SUB ff/v1/7N152GxG2p/p/PROJECT-OWN-ID-aa97-8915e1897326/in/a/b
            }
        } else if (node.type === 'project link out') {
            topicParts.push('p')
            if (broadcast) {
                // publish to all (broadcast)
                topicParts.push(OWNER_ID)
                topicParts.push('out')
                // e.g. PUB topic ff/v1/7N152GxG2p/p/PROJECT-OWN-ID-aa97-8915e1897326/out/a/b
                // e.g. PUB ff/v1/7N152GxG2p/p/app:<app-id>/out/a/b
            } else {
                // publish to a specific project
                topicParts.push(projectOrAppID)
                topicParts.push('in')
                // e.g. PUB ff/v1/7N152GxG2p/p/TARGET-PROJ-ID-aa97-8915e1897326/in/a/b
                // e.g. PUB ff/v1/7N152GxG2p/p/app:<app-id>/in/a/b
            }
        }
        topicParts.push(subTopic)
        const topic = topicParts.join('/')
        return topic
    }
    // #endregion Helpers

    // mqtt encapsulation
    const mqtt = (function () {
        const allNodes = new Set()
        /** @type {MQTT.MqttClient} */
        let client
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
                if (topicParts[5] === 'out') {
                    topicParts[4] = '+' // ff/v1/team-id/p/+/out/sub-topic all projects
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
                msg.projectLink = {
                    ...msg.projectLink,
                    instanceId: packet.properties?.userProperties?._projectID || '',
                    projectId: packet.properties?.userProperties?._projectID || '',
                    applicationId: packet.properties?.userProperties?._applicationID || '',
                    topic: topic.split('/').slice(6).join('/')
                }
                if (packet.properties?.userProperties?._deviceId) {
                    msg.projectLink.deviceId = packet.properties?.userProperties?._deviceId
                    msg.projectLink.deviceName = packet.properties?.userProperties?._deviceName
                    msg.projectLink.deviceType = packet.properties?.userProperties?._deviceType
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
        }
        function onReconnect () {
            RED.log.trace('Project Link nodes reconnecting')
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
                client.removeListener(l.event, l.handler)
                return false // found and removed, filter out this one
            })
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
                subOptions.qos = subOptions.qos == null ? 1 : subOptions.qos
                subOptions.properties = Object.assign({}, options.properties)
                subOptions.properties.userProperties = subOptions.properties.userProperties || {}
                subOptions.properties.userProperties._projectID = RED.settings.flowforge.projectID || ''
                subOptions.properties.userProperties._applicationID = RED.settings.flowforge.applicationID || ''
                subOptions.properties.userProperties._deviceID = RED.settings.flowforge.deviceID || ''
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
                            client.subscribe(topic, subOptions)
                            resolve(true)
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
                const subID = [null, 1, 2][node.subscriptionIdentifier]
                if (subID) {
                    lookupTopic = subID + ':' + topic
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
                pubOptions.qos = pubOptions.qos == null ? 1 : pubOptions.qos
                pubOptions.properties = Object.assign({}, options.properties)
                pubOptions.properties.userProperties = pubOptions.properties.userProperties || {}
                pubOptions.properties.userProperties._projectID = RED.settings.flowforge.projectID || ''
                pubOptions.properties.userProperties._applicationID = RED.settings.flowforge.applicationID || ''
                if (process.env.FF_DEVICE_ID) {
                    pubOptions.properties.userProperties._deviceId = process.env.FF_DEVICE_ID
                    pubOptions.properties.userProperties._deviceName = process.env.FF_DEVICE_NAME
                    pubOptions.properties.userProperties._deviceType = process.env.FF_DEVICE_TYPE
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

                    /** @type {MQTT.IClientOptions} */
                    const defaultOptions = {
                        protocolVersion: 5,
                        reconnectPeriod: RED.settings.mqttReconnectTime || 5000,
                        properties: {
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
                    client = MQTT.connect(parsedURL, options)
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
                const closeMessage = null // FUTURE: Let broker/clients know of issue via close msg
                const _callback = function (err) {
                    connecting = false
                    connected = false
                    closing = false
                    done && typeof done === 'function' && done(err)
                }
                if (!client) { return _callback() }

                const waitEnd = (client, ms) => {
                    return new Promise((resolve, reject) => {
                        closing = true
                        if (!client || !connected) {
                            resolve()
                        } else {
                            const t = setTimeout(() => {
                                if (!connected) {
                                    resolve()
                                } else {
                                    // clean end() has exceeded WAIT_END, lets force end!
                                    client && client.end(true)
                                    reject(new Error('timeout'))
                                }
                            }, ms)
                            client.end(() => {
                                clearTimeout(t)
                                resolve()
                            })
                        }
                    })
                }
                if (connected && closeMessage) {
                    mqtt.publish(closeMessage, function (err) {
                        waitEnd(client, 2000).then(() => {
                            _callback(err)
                        }).catch((e) => {
                            _callback(e)
                        })
                    })
                } else {
                    waitEnd(client, 2000).then(() => {
                        _callback()
                    }).catch((_e) => {
                        _callback()
                    })
                }
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
        node.project = n.project
        node.subscriptionIdentifier = (n.broadcast && n.project === 'all') ? 2 : 1
        node.subTopic = n.topic
        node.broadcast = n.broadcast === true || n.broadcast === 'true'
        node.topic = buildLinkTopic(node, node.project, node.subTopic, node.broadcast)
        mqtt.connect()
        mqtt.registerStatus(node)

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
        // to my inbox (direct to device not supported, only direct to an instance is currently supported)
        // * this project in           ff/v1/7N152GxG2p/p/ca65f5ed-aea0-4a10-ac9a-2086b6af6700/in/b1/b1     sub proj→prog
        // broadcasts
        // * specific project out      ff/v1/7N152GxG2p/p/ca65f5ed-aea0-4a10-ac9a-2086b6af6700/out/b1/b1    sub broadcast
        // * +any project/device+ out  ff/v1/7N152GxG2p/p/+/out/b1/b1                                       sub broadcast
        let subscribedTopic = node.topic
        if (RED.settings.flowforge.useSharedSubscriptions) {
            subscribedTopic = `$share/${RED.settings.flowforge.projectID}/${node.topic}`
        }
        // ↓ Useful for debugging ↓
        // console.log(`🔗 LINK-IN SUB ${subscribedTopic}`)
        mqtt.subscribe(node, subscribedTopic, { qos: 2 }, onSub)
            .then(_result => {})
            .catch(err => {
                node.status({ fill: 'red', shape: 'dot', text: 'subscribe error' })
                node.error(err)
            })

        this.on('input', function (msg, send, done) {
            send(msg)
            done()
        })
        node.on('close', function (done) {
            mqtt.unsubscribe(node, subscribedTopic, onSub)
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
    RED.nodes.registerType('project link in', ProjectLinkInNode)

    // Project Link Out Node
    function ProjectLinkOutNode (n) {
        RED.nodes.createNode(this, n)
        const node = this
        node.project = n.project
        node.subTopic = n.topic
        node.mode = n.mode || 'link'
        node.broadcast = n.broadcast === true || n.broadcast === 'true'
        mqtt.connect()
        mqtt.registerStatus(node)
        node.on('input', async function (msg, _send, done) {
            try {
                if (node.mode === 'return') {
                    if (msg.projectLink?.callStack?.length > 0) {
                        /** @type {MessageEvent} */
                        const messageEvent = msg.projectLink.callStack.pop()
                        const targetId = messageEvent.project || `app:${messageEvent.application}`
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
                    const topic = buildLinkTopic(node, node.project, node.subTopic, node.broadcast)
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
        node.project = n.project
        node.subTopic = n.topic
        node.topic = buildLinkTopic(node, node.project, node.subTopic, false)
        if (RED.settings.flowforge.useSharedSubscriptions) {
            node.responseTopicPrefix = `res-${crypto.randomBytes(4).toString('hex')}`
        } else {
            node.responseTopicPrefix = 'res'
        }
        node.responseTopic = buildLinkTopic(node, OWNER_ID, node.subTopic, false, node.responseTopicPrefix)
        // node.responseTopic = buildLinkTopic(node, RED.settings.flowforge.projectID, node.subTopic, false, node.responseTopicPrefix)
        let timeout = parseFloat(n.timeout || '30') * 1000
        if (isNaN(timeout)) {
            timeout = 30000
        }
        /** @type {MessageEvents} */
        const messageEvents = {}

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

        mqtt.connect()
        mqtt.registerStatus(node)
        // ↓ Useful for debugging ↓
        // console.log(`🔗 LINK-CALL responseTopic SUB ${node.responseTopic}`)
        mqtt.subscribe(node, node.responseTopic, { qos: 2 }, onSub)
            .then(_result => {})
            .catch(err => {
                node.status({ fill: 'red', shape: 'dot', text: 'subscribe error' })
                node.error(err)
            })

        node.on('input', async function (msg, send, done) {
            try {
                const eventId = crypto.randomBytes(14).toString('hex')
                /** @type {MessageEvent} */
                const messageEvent = {
                    eventId,
                    node: node.id,
                    project: RED.settings.flowforge.projectID,
                    instance: RED.settings.flowforge.instanceID,
                    application: RED.settings.flowforge.applicationID,
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
                node.error('timeout', messageEvent.msg)
            }
        }
    }
    RED.nodes.registerType('project link call', ProjectLinkCallNode)

    // Endpoint for querying list of projects in node UI
    RED.httpAdmin.get('/nr-project-link/projects', RED.auth.needsPermission('flows.write'), async function (_req, res) {
        const url = `${RED.settings.flowforge.forgeURL}/api/${API_VERSION}/teams/${RED.settings.flowforge.teamID}/projects`
        try {
            const data = await got.get(url, {
                headers: {
                    Authorization: `Bearer ${RED.settings.flowforge.projectLink.token}`
                },
                timeout: {
                    request: 4000
                }
            }).json()
            if (data != null) {
                res.json(data)
            } else {
                res.sendStatus(404)
            }
        } catch (err) {
            res.sendStatus(500)
        }
    })
}
