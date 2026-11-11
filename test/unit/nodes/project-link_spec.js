const should = require('should')
const mocha = require('mocha') // eslint-disable-line no-unused-vars
const sinon = require('sinon')
const utils = require('../../../lib/utils.js')
const MQTT = require('mqtt')
const projectLinkPackage = require('../../../nodes/project-link.js')
const { HttpProxyAgent } = require('http-proxy-agent')
const { HttpsProxyAgent } = require('https-proxy-agent')
const InstancesApi = require('../../../lib/InstancesApi.js')

const TEAM_ID = 'ABCD5678'
const flushPromises = () => new Promise(resolve => setImmediate(resolve))
const PROJECT_ID = '12345678-1234-5678-9012-9876abcdef12'
describe('project-link node', function () {
    afterEach(function () {
        delete process.env.http_proxy
        delete process.env.https_proxy
        sinon.restore()
    })

    function setup (options) {
        const { httpProxy, httpsProxy, allProxy, noProxy, forgeUrl, mqttUrl, haMode } = options || {}
        const mqttStub = {
            on: sinon.fake(),
            subscribe: sinon.fake(),
            unsubscribe: sinon.fake(),
            publish: sinon.fake(function (topic, message, options, callback) {
                const pkt = { topic, message, options }
                callback(null, pkt)
            }),
            removeAllListeners: sinon.fake(),
            end: sinon.fake()
        }
        // mqtt 5 exports `connect` as a read only getter that reads it from `MQTT.default`
        const mqttConnectStub = sinon.stub(MQTT.default, 'connect').returns(mqttStub)
        process.env.http_proxy = httpProxy || ''
        process.env.https_proxy = httpsProxy || ''
        process.env.all_proxy = allProxy || ''
        process.env.no_proxy = noProxy || ''
        const nodes = {}
        const RED = {
            settings: {
                flowforge: {
                    forgeURL: forgeUrl || 'https://local.testfuse.com',
                    projectID: PROJECT_ID,
                    teamID: TEAM_ID,
                    projectLink: {
                        featureEnabled: true,
                        broker: {
                            url: mqttUrl || 'ws://localhost',
                            username: 'test-username',
                            password: 'test-password'
                        },
                        useSharedSubscriptions: haMode
                    }
                }
            },
            log: {
                error: sinon.fake(() => { console.error(...arguments) }),
                debug: sinon.fake(() => { console.debug(...arguments) }),
                log: sinon.fake(() => { console.log(...arguments) }), // eslint-disable-line no-console
                warn: sinon.fake(() => { console.warn(...arguments) }),
                info: sinon.fake(() => { console.info(...arguments) }),
                trace: sinon.fake(() => { console.trace(...arguments) }) // eslint-disable-line no-console
            },
            nodes: {
                createNode: function (node, config) {
                    return node
                },
                // RED.nodes.registerType('project link in', ProjectLinkInNode, {
                registerType: sinon.fake((name, NodeConstructor, options) => {
                    nodes[name] = {
                        name,
                        NodeConstructor,
                        options
                    }
                })
            },
            httpAdmin: {
                get: sinon.stub()
            },
            auth: {
                needsPermission: sinon.stub()
            },
            util: {
                cloneMessage (msg) {
                    return JSON.parse(JSON.stringify(msg))
                },
                evaluateNodeProperty (value, type, _node, msg) {
                    if (type === 'msg') {
                        return value.split('.').reduce((obj, key) => obj?.[key], msg)
                    }
                    if (type === 'env') {
                        // a bare name, or a template such as `a/${NAME}/b` (an unset variable is an empty string)
                        return /\$\{[^}]+\}/.test(value)
                            ? value.replace(/\$\{([^}]+)\}/g, (_match, name) => process.env[name] ?? '')
                            : process.env[value]
                    }
                    throw new Error(`unsupported type ${type}`)
                }
            }
        }
        return {
            RED,
            nodes,
            mqttStub,
            mqttConnectStub
        }
    }

    describe('proxy', function () {
        afterEach(function () {
            sinon.restore()
        })

        describe('got', function () {
            it('should not add proxy to GOT instance if env vars are not set', function () {
                const env = setup()
                const RED = env.RED
                const spy = sinon.spy(utils, 'getHTTPProxyAgent')
                projectLinkPackage(RED)
                spy.calledOnce.should.be.true()
                spy.returned({}).should.be.true()
            })
            it('should not add proxy to GOT instance if no_proxy is configured to include forge domain', function () {
                const env = setup({
                    httpProxy: 'http://proxy:3128',
                    httpsProxy: null,
                    allProxy: null,
                    noProxy: 'testfuse.com',
                    forgeUrl: 'https://testfuse.com',
                    mqttUrl: 'wss://testfuse.com'
                })
                const RED = env.RED
                const spy = sinon.spy(utils, 'getHTTPProxyAgent')
                projectLinkPackage(RED)
                spy.calledOnce.should.be.true()
                spy.returned({}).should.be.true()
            })
            it('should not add proxy to GOT instance for http request if http_proxy is unset', function () {
                const env = setup({
                    httpProxy: null,
                    httpsProxy: 'http://localhost:3128',
                    allProxy: null,
                    noProxy: '127.0.0.1,google.com',
                    forgeUrl: 'http://testfuse.com',
                    mqttUrl: 'ws://testfuse.com'
                })
                const RED = env.RED
                const spy = sinon.spy(utils, 'getHTTPProxyAgent')
                projectLinkPackage(RED)
                spy.calledOnce.should.be.true()
                spy.returned({}).should.be.true()
            })
            it('should not add proxy to GOT instance for https request if https_proxy is unset', function () {
                const env = setup({
                    httpProxy: 'http://localhost:3128',
                    httpsProxy: null,
                    allProxy: null,
                    noProxy: '127.0.0.1,google.com',
                    forgeUrl: 'https://testfuse.com',
                    mqttUrl: 'wss://testfuse.com'
                })
                const RED = env.RED
                const spy = sinon.spy(utils, 'getHTTPProxyAgent')
                projectLinkPackage(RED)
                spy.calledOnce.should.be.true()
                spy.returned({}).should.be.true()
            })
            it('should add http proxy to GOT instance if env vars are set', function () {
                const env = setup({
                    httpProxy: 'http://localhost:3128',
                    httpsProxy: null,
                    allProxy: null,
                    noProxy: '127.0.0.1,google.com',
                    forgeUrl: 'http://testfuse.com',
                    mqttUrl: 'ws://testfuse.com'
                })
                const RED = env.RED
                const spy = sinon.spy(utils, 'getHTTPProxyAgent')
                projectLinkPackage(RED)
                spy.calledOnce.should.be.true()
                const getHTTPProxyAgentReturnValue = spy.returnValues[0]
                getHTTPProxyAgentReturnValue.should.have.property('http').and.be.an.instanceOf(HttpProxyAgent)
                getHTTPProxyAgentReturnValue.should.not.have.property('https')
            })
            it('should add https proxy to GOT instance if env vars are set', function () {
                const env = setup({
                    httpProxy: null,
                    httpsProxy: 'http://localhost:3128',
                    allProxy: null,
                    noProxy: '127.0.0.1,google.com',
                    forgeUrl: 'https://testfuse.com',
                    mqttUrl: 'wss://testfuse.com'
                })
                const RED = env.RED
                const spy = sinon.spy(utils, 'getHTTPProxyAgent')
                projectLinkPackage(RED)
                spy.calledOnce.should.be.true()
                const getHTTPProxyAgentReturnValue = spy.returnValues[0]
                getHTTPProxyAgentReturnValue.should.have.property('https').and.be.an.instanceOf(HttpsProxyAgent)
                getHTTPProxyAgentReturnValue.should.not.have.property('http')
            })
            it('should add http proxy to GOT instance if all_proxy is set', function () {
                const env = setup({
                    httpProxy: null,
                    httpsProxy: null,
                    allProxy: 'http://localhost:3128',
                    noProxy: null,
                    forgeUrl: 'http://testfuse.com',
                    mqttUrl: 'ws://testfuse.com'
                })
                const RED = env.RED
                const spy = sinon.spy(utils, 'getHTTPProxyAgent')
                projectLinkPackage(RED)
                spy.calledOnce.should.be.true()
                const getHTTPProxyAgentReturnValue = spy.returnValues[0]
                getHTTPProxyAgentReturnValue.should.have.property('http').and.be.an.instanceOf(HttpProxyAgent)
                getHTTPProxyAgentReturnValue.should.not.have.property('https')
            })
            it('should add https proxy to GOT instance if all_proxy is set', function () {
                const env = setup({
                    httpProxy: null,
                    httpsProxy: null,
                    allProxy: 'http://localhost:3128',
                    noProxy: null,
                    forgeUrl: 'https://testfuse.com',
                    mqttUrl: 'wss://testfuse.com'
                })
                const RED = env.RED
                const spy = sinon.spy(utils, 'getHTTPProxyAgent')
                projectLinkPackage(RED)
                spy.calledOnce.should.be.true()
                const getHTTPProxyAgentReturnValue = spy.returnValues[0]
                getHTTPProxyAgentReturnValue.should.have.property('https').and.be.an.instanceOf(HttpsProxyAgent)
                getHTTPProxyAgentReturnValue.should.not.have.property('http')
            })
        })
        describe('MQTT', function () {
            const baseNode = {
                on: sinon.fake()
            }
            it('should not add proxy to MQTT if env vars are not set', function () {
                const env = setup()
                const RED = env.RED
                const spy = sinon.spy(utils, 'getWSProxyAgent')
                projectLinkPackage(RED)
                const NodeConstructor = env.nodes['project link in'].NodeConstructor
                // creating any of the nodes will cause MQTT to attempt connection and thus call getWSProxyAgent (if it's going to be called)
                NodeConstructor.call(baseNode, { topic: 'ff/v1/0A1B2C3D4F/p/00001111-1234-5678-9012-9876abcdef12/out/test/test', timeout: 1.5 })
                spy.calledOnce.should.be.false()
            })
            it('should not add proxy to MQTT if no_proxy includes target domain', function () {
                const env = setup({
                    httpProxy: 'http://localhost:3128',
                    httpsProxy: null,
                    allProxy: null,
                    noProxy: '127.0.0.1,testfuse.com,other-domain,.parent-domain.io',
                    forgeUrl: 'https://testfuse.com',
                    mqttUrl: 'ws://testfuse.com'
                })
                const RED = env.RED
                const spy = sinon.spy(utils, 'getWSProxyAgent')
                projectLinkPackage(RED)
                const NodeConstructor = env.nodes['project link in'].NodeConstructor
                // creating any of the nodes will cause MQTT to attempt connection and thus call getWSProxyAgent (if it's going to be called)
                NodeConstructor.call(baseNode, { topic: 'ff/v1/0A1B2C3D4F/p/00001111-1234-5678-9012-9876abcdef12/out/test/test', timeout: 1.5 })

                spy.calledOnce.should.be.true()
                env.mqttConnectStub.calledOnce.should.be.true()
                const mqttConnectOptions = env.mqttConnectStub.args[0][0]
                should(mqttConnectOptions.wsOptions?.agent).be.null()
            })
            it('should connect to the broker URL', function () {
                const env = setup({ mqttUrl: 'wss://broker.testfuse.com:8443/mqtt' })
                projectLinkPackage(env.RED)
                const NodeConstructor = env.nodes['project link in'].NodeConstructor
                NodeConstructor.call(baseNode, { topic: 'ff/v1/0A1B2C3D4F/p/00001111-1234-5678-9012-9876abcdef12/out/test/test', timeout: 1.5 })
                env.mqttConnectStub.calledOnce.should.be.true()
                const connectOptions = env.mqttConnectStub.args[0][0]
                connectOptions.should.have.property('protocol', 'wss')
                connectOptions.should.have.property('hostname', 'broker.testfuse.com')
                connectOptions.should.have.property('port', 8443)
                connectOptions.should.have.property('path', '/mqtt')
            })
            it('should keep the path and query of the broker URL', function () {
                const env = setup({ mqttUrl: 'ws://broker.testfuse.com/some/path?x=1' })
                projectLinkPackage(env.RED)
                const NodeConstructor = env.nodes['project link in'].NodeConstructor
                NodeConstructor.call(baseNode, { topic: 'ff/v1/0A1B2C3D4F/p/00001111-1234-5678-9012-9876abcdef12/out/test/test', timeout: 1.5 })
                env.mqttConnectStub.calledOnce.should.be.true()
                const connectOptions = env.mqttConnectStub.args[0][0]
                connectOptions.should.have.property('path', '/some/path?x=1')
            })
            it('should leave the port unset when the broker URL has none', function () {
                const env = setup({ mqttUrl: 'wss://broker.testfuse.com' })
                projectLinkPackage(env.RED)
                const NodeConstructor = env.nodes['project link in'].NodeConstructor
                NodeConstructor.call(baseNode, { topic: 'ff/v1/0A1B2C3D4F/p/00001111-1234-5678-9012-9876abcdef12/out/test/test', timeout: 1.5 })
                env.mqttConnectStub.calledOnce.should.be.true()
                const connectOptions = env.mqttConnectStub.args[0][0]
                connectOptions.should.have.property('port', undefined)
            })
            it('should keep the brackets of an ipv6 ws broker hostname', function () {
                const env = setup({ mqttUrl: 'ws://[::1]:8883' })
                projectLinkPackage(env.RED)
                const NodeConstructor = env.nodes['project link in'].NodeConstructor
                NodeConstructor.call(baseNode, { topic: 'ff/v1/0A1B2C3D4F/p/00001111-1234-5678-9012-9876abcdef12/out/test/test', timeout: 1.5 })
                env.mqttConnectStub.calledOnce.should.be.true()
                const connectOptions = env.mqttConnectStub.args[0][0]
                connectOptions.should.have.property('hostname', '[::1]')
                connectOptions.should.have.property('port', 8883)
            })
            it('should remove the brackets of an ipv6 mqtt broker hostname', function () {
                const env = setup({ mqttUrl: 'mqtt://[::1]:1883' })
                projectLinkPackage(env.RED)
                const NodeConstructor = env.nodes['project link in'].NodeConstructor
                NodeConstructor.call(baseNode, { topic: 'ff/v1/0A1B2C3D4F/p/00001111-1234-5678-9012-9876abcdef12/out/test/test', timeout: 1.5 })
                env.mqttConnectStub.calledOnce.should.be.true()
                const connectOptions = env.mqttConnectStub.args[0][0]
                connectOptions.should.have.property('protocol', 'mqtt')
                connectOptions.should.have.property('hostname', '::1')
                connectOptions.should.have.property('port', 1883)
            })
            it('should add http proxy to MQTT if env vars are set', function () {
                const env = setup({
                    httpProxy: 'http://localhost:3128',
                    httpsProxy: null,
                    allProxy: null,
                    noProxy: null,
                    forgeUrl: null,
                    mqttUrl: null
                })
                const RED = env.RED
                const spy = sinon.spy(utils, 'getWSProxyAgent')
                projectLinkPackage(RED)
                const NodeConstructor = env.nodes['project link in'].NodeConstructor
                // creating any of the nodes will cause MQTT to attempt connection and thus call getWSProxyAgent (if it's going to be called)
                NodeConstructor.call(baseNode, { topic: 'ff/v1/0A1B2C3D4F/p/00001111-1234-5678-9012-9876abcdef12/out/test/test', timeout: 1.5 })
                spy.calledOnce.should.be.true()
                const getWSProxyAgentReturnValue = spy.returnValues[0]
                getWSProxyAgentReturnValue.should.be.an.instanceOf(HttpProxyAgent)

                env.mqttConnectStub.calledOnce.should.be.true()
                const mqttConnectOptions = env.mqttConnectStub.args[0][0]
                mqttConnectOptions.should.have.property('wsOptions').and.be.an.Object()
                mqttConnectOptions.wsOptions.should.have.property('agent').and.be.an.instanceOf(HttpProxyAgent)
            })
            it('should add https proxy to MQTT if env vars are set', function () {
                const env = setup({
                    httpProxy: null,
                    httpsProxy: 'http://localhost:3128',
                    allProxy: null,
                    noProxy: null,
                    forgeUrl: null,
                    mqttUrl: 'wss://localhost:1883'
                })
                const RED = env.RED
                const spy = sinon.spy(utils, 'getWSProxyAgent')
                projectLinkPackage(RED)
                const NodeConstructor = env.nodes['project link in'].NodeConstructor
                // creating any of the nodes will cause MQTT to attempt connection and thus call getWSProxyAgent (if it's going to be called)
                NodeConstructor.call(baseNode, { topic: 'ff/v1/0A1B2C3D4F/p/00001111-1234-5678-9012-9876abcdef12/out/test/test', timeout: 1.5 })
                spy.calledOnce.should.be.true()
                const getWSProxyAgentReturnValue = spy.returnValues[0]
                getWSProxyAgentReturnValue.should.be.an.instanceOf(HttpsProxyAgent)

                env.mqttConnectStub.calledOnce.should.be.true()
                const mqttConnectOptions = env.mqttConnectStub.args[0][0]
                mqttConnectOptions.should.have.property('wsOptions').and.be.an.Object()
                mqttConnectOptions.wsOptions.should.have.property('agent').and.be.an.instanceOf(HttpsProxyAgent)
            })
            it('should add http proxy to MQTT if all_proxy is set', function () {
                const env = setup({
                    httpProxy: null,
                    httpsProxy: null,
                    allProxy: 'http://localhost:3128',
                    noProxy: null,
                    forgeUrl: null,
                    mqttUrl: null
                })
                const RED = env.RED
                const spy = sinon.spy(utils, 'getWSProxyAgent')
                projectLinkPackage(RED)
                const NodeConstructor = env.nodes['project link in'].NodeConstructor
                // creating any of the nodes will cause MQTT to attempt connection and thus call getWSProxyAgent (if it's going to be called)
                NodeConstructor.call(baseNode, { topic: 'ff/v1/0A1B2C3D4F/p/00001111-1234-5678-9012-9876abcdef12/out/test/test', timeout: 1.5 })
                spy.calledOnce.should.be.true()
                const getWSProxyAgentReturnValue = spy.returnValues[0]
                getWSProxyAgentReturnValue.should.be.an.instanceOf(HttpProxyAgent)

                env.mqttConnectStub.calledOnce.should.be.true()
                const mqttConnectOptions = env.mqttConnectStub.args[0][0]
                mqttConnectOptions.should.have.property('wsOptions').and.be.an.Object()
                mqttConnectOptions.wsOptions.should.have.property('agent').and.be.an.instanceOf(HttpProxyAgent)
            })
            it('should add https proxy to MQTT if all_proxy is set', function () {
                const env = setup({
                    httpProxy: null,
                    httpsProxy: null,
                    allProxy: 'http://localhost:3128',
                    noProxy: null,
                    forgeUrl: null,
                    mqttUrl: 'wss://localhost:1883'
                })
                const RED = env.RED
                const spy = sinon.spy(utils, 'getWSProxyAgent')
                projectLinkPackage(RED)
                const NodeConstructor = env.nodes['project link in'].NodeConstructor
                // creating any of the nodes will cause MQTT to attempt connection and thus call getWSProxyAgent (if it's going to be called)
                NodeConstructor.call(baseNode, { topic: 'ff/v1/0A1B2C3D4F/p/00001111-1234-5678-9012-9876abcdef12/out/test/test', timeout: 1.5 })
                spy.calledOnce.should.be.true()
                const getWSProxyAgentReturnValue = spy.returnValues[0]
                getWSProxyAgentReturnValue.should.be.an.instanceOf(HttpsProxyAgent)

                env.mqttConnectStub.calledOnce.should.be.true()
                const mqttConnectOptions = env.mqttConnectStub.args[0][0]
                mqttConnectOptions.should.have.property('wsOptions').and.be.an.Object()
                mqttConnectOptions.wsOptions.should.have.property('agent').and.be.an.instanceOf(HttpsProxyAgent)
            })
        })
    })
    describe('Nodes', function () {
        it('project link in should subscribe using QoS 2', function () {
            const env = setup()
            const inNode = {
                on: sinon.fake(),
                type: 'project link in'
            }
            const topic = 'cloud/project-nodes-test/xxx'
            const RED = env.RED
            projectLinkPackage(RED)
            const NodeConstructor = env.nodes['project link in'].NodeConstructor
            NodeConstructor.call(inNode, { topic, project: PROJECT_ID, timeout: 1.5 })

            // Validate connect options
            const mqttConnectOptions = env.mqttConnectStub.args[0][0]
            mqttConnectOptions.should.have.property('username', 'test-username')
            mqttConnectOptions.should.have.property('password', 'test-password')
            mqttConnectOptions.should.have.property('clientId', 'test-username:n')

            env.mqttStub.subscribe.calledOnce.should.be.true()
            should(env.mqttStub.subscribe.args[0][0]).equal(`ff/v1/${TEAM_ID}/p/${PROJECT_ID}/in/${topic}`)
            const options = env.mqttStub.subscribe.args[0][1]
            should(options).be.an.Object()
            options.should.have.property('qos').and.equal(2)
            options.should.have.property('properties').and.be.an.Object()
            options.properties.should.have.property('subscriptionIdentifier').and.be.a.Number()
        })
        it('project link call should publish and subscribe using QoS 2', async function () {
            const env = setup()
            const RED = env.RED
            const nodeEvents = {}
            const callNode = {
                on: (event, cb) => {
                    nodeEvents[event] = cb
                },
                error: sinon.fake(),
                type: 'project link call'
            }
            const getInstancesStub = sinon.stub().resolves({ count: 1, instances: [{ id: PROJECT_ID, name: 'A-PROJECT' }] })
            InstancesApi.InstancesApi = sinon.stub().returns({
                getInstances: getInstancesStub
            })
            const topic = 'cloud/project-nodes-test/call'
            const expectedPubTopic = `ff/v1/${TEAM_ID}/p/${PROJECT_ID}/in/${topic}`
            const expectedSubTopic = `ff/v1/${TEAM_ID}/p/${PROJECT_ID}/res/${topic}`
            projectLinkPackage(RED)
            const NodeConstructor = env.nodes['project link call'].NodeConstructor
            NodeConstructor.call(callNode, { topic, project: PROJECT_ID, timeout: 1.5 })
            await getInstancesStub
            callNode.should.have.property('topic', expectedPubTopic)
            callNode.should.have.property('responseTopic', expectedSubTopic)
            env.mqttStub.subscribe.calledOnce.should.be.true()
            should(env.mqttStub.subscribe.args[0][0]).equal(expectedSubTopic)
            const options = env.mqttStub.subscribe.args[0][1]
            should(options).be.an.Object()
            options.should.have.property('qos').and.equal(2)

            // send a message to the node so that it can publish
            nodeEvents.input({ payload: 'test' }, sinon.fake(), sinon.fake())

            // ensure qos 2 on the publish
            env.mqttStub.publish.calledOnce.should.be.true()
            const pubTopic = env.mqttStub.publish.args[0][0]
            should(pubTopic).equal(expectedPubTopic)
            const pubMessageStr = env.mqttStub.publish.args[0][1]
            const pubMessage = JSON.parse(pubMessageStr)
            should(pubMessage).be.an.Object()
            pubMessage.should.have.property('payload').and.equal('test')
            pubMessage.should.have.property('projectLink').and.be.an.Object()
            pubMessage.projectLink.should.have.property('callStack').and.be.an.Array()
            pubMessage.projectLink.callStack.should.have.length(1)
            pubMessage.projectLink.callStack[0].should.have.property('topic').and.equal(topic)
            pubMessage.projectLink.callStack[0].should.have.property('ts').and.be.a.Number()
            pubMessage.projectLink.callStack[0].should.have.property('response').and.equal('res')
            pubMessage.projectLink.callStack[0].should.have.property('application')
            pubMessage.projectLink.callStack[0].should.have.property('instance')
            pubMessage.projectLink.callStack[0].should.have.property('node')
            pubMessage.projectLink.callStack[0].should.have.property('project').and.equal(PROJECT_ID)
            pubMessage.projectLink.callStack[0].should.have.property('eventId').and.be.a.String()

            const pubOptions = env.mqttStub.publish.args[0][2]
            should(pubOptions).be.an.Object()
            pubOptions.should.have.property('qos').and.equal(2)
        })
        it('project link call should ignore responses without correlation data', async function () {
            const env = setup()
            const RED = env.RED
            const nodeEvents = {}
            const callNode = {
                on: (event, cb) => {
                    nodeEvents[event] = cb
                },
                error: sinon.fake(),
                type: 'project link call'
            }
            InstancesApi.InstancesApi = sinon.stub().returns({
                getInstances: sinon.stub().resolves({ count: 1, instances: [{ id: PROJECT_ID, name: 'A-PROJECT' }] })
            })
            const topic = 'cloud/project-nodes-test/call'
            projectLinkPackage(RED)
            const NodeConstructor = env.nodes['project link call'].NodeConstructor
            NodeConstructor.call(callNode, { topic, project: PROJECT_ID, timeout: 0.05 })
            const send = sinon.fake()
            const done = sinon.fake()
            nodeEvents.input({ payload: 'test' }, send, done)

            const onMessage = env.mqttStub.on.args.find(args => args[0] === 'message')[1]
            const responseTopic = `ff/v1/${TEAM_ID}/p/${PROJECT_ID}/res/${topic}`
            const message = Buffer.from(JSON.stringify({ payload: 'response' }))
            should.doesNotThrow(() => onMessage(responseTopic, message, { properties: {} }))
            should.doesNotThrow(() => onMessage(responseTopic, message, {}))

            send.called.should.be.false()
            done.called.should.be.false()
        })
        it('project link call should name the target and topic when a call times out', async function () {
            const env = setup()
            const RED = env.RED
            const nodeEvents = {}
            const callNode = {
                on: (event, cb) => {
                    nodeEvents[event] = cb
                },
                error: sinon.fake(),
                type: 'project link call'
            }
            const getInstancesStub = sinon.stub().resolves({ count: 1, instances: [{ id: PROJECT_ID, name: 'A-PROJECT' }] })
            InstancesApi.InstancesApi = sinon.stub().returns({
                getInstances: getInstancesStub
            })
            const topic = 'cloud/project-nodes-test/call'
            projectLinkPackage(RED)
            const NodeConstructor = env.nodes['project link call'].NodeConstructor
            NodeConstructor.call(callNode, { topic, project: PROJECT_ID, timeout: 0.05 })
            await getInstancesStub

            nodeEvents.input({ payload: 'test' }, sinon.fake(), sinon.fake())
            await new Promise(resolve => setTimeout(resolve, 150))

            callNode.error.called.should.be.true()
            const message = callNode.error.args[0][0]
            message.should.match(/timeout after 0.1s/)
            message.should.match(/A-PROJECT/)
            message.should.match(/cloud\/project-nodes-test\/call/)
            message.should.match(/project link in/)
        })
        it('project link out should publish using QoS 2', async function () {
            const env = setup()
            const RED = env.RED
            const nodeEvents = {}
            const outNode = {
                on: (event, cb) => {
                    nodeEvents[event] = cb
                },
                error: sinon.fake(),
                type: 'project link call',
                mode: 'link'
            }
            const topic = 'cloud/project-nodes-test/xxx'
            const expectedPubTopic = `ff/v1/${TEAM_ID}/p/${PROJECT_ID}/in/${topic}`
            projectLinkPackage(RED)
            const NodeConstructor = env.nodes['project link out'].NodeConstructor
            NodeConstructor.call(outNode, { topic, project: PROJECT_ID, timeout: 1.5 })
            outNode.should.have.property('subTopic', topic)

            // send a message to the node so that it can publish
            await nodeEvents.input({ payload: 'test' }, sinon.fake(), sinon.fake())

            env.mqttStub.publish.calledOnce.should.be.true()
            const pubTopic = env.mqttStub.publish.args[0][0]
            should(pubTopic).equal(expectedPubTopic)
            const pubMessageStr = env.mqttStub.publish.args[0][1]
            const pubMessage = JSON.parse(pubMessageStr)
            should(pubMessage).be.an.Object()
            pubMessage.should.have.property('payload').and.equal('test')
            const pubOptions = env.mqttStub.publish.args[0][2]
            should(pubOptions).be.an.Object()
            pubOptions.should.have.property('qos').and.equal(2)
            pubOptions.should.have.property('properties').and.be.an.Object()
            pubOptions.properties.should.have.property('contentType', 'application/json')
            pubOptions.properties.should.have.property('userProperties').and.be.an.Object()
            pubOptions.properties.userProperties.should.have.property('_nodeID')
            pubOptions.properties.userProperties.should.have.property('_projectID', PROJECT_ID)
            pubOptions.properties.userProperties.should.have.property('_applicationID')
            pubOptions.properties.userProperties.should.have.property('_publishTime').and.be.a.Number()
        })
        it('project link in should not check getInstances when node has default settings', async function () {
            // by default, the project link in node is set to "Receive messages sent to this instance" not
            // "Listen for broadcast messages from ...", therefore it should not check for instances
            const env = setup()
            const RED = env.RED
            const inNode = {
                on: sinon.stub().resolves(),
                type: 'project link in',
                status: sinon.fake(),
                warn: sinon.stub().resolves()
            }
            const getInstancesStub = sinon.stub().resolves({ count: 1, projects: [{ id: PROJECT_ID, name: 'A-PROJECT' }] })
            InstancesApi.InstancesApi = sinon.stub().returns({
                getInstances: getInstancesStub
            })
            const topic = 'cloud/project-nodes-test/xxx'
            projectLinkPackage(RED)
            const NodeConstructor = env.nodes['project link in'].NodeConstructor
            NodeConstructor.call(inNode, { topic, timeout: 1.5 })
            // wait for the on call to complete before checking status
            await inNode.on
            getInstancesStub.called.should.be.false()
        })
        it('project link out should not check getInstances when set to "return" mode', async function () {
            // when the project link out node is set to "return" mode, it should not check for projects
            const env = setup()
            const RED = env.RED
            const outNode = {
                on: sinon.stub().resolves(),
                type: 'project link out',
                status: sinon.fake(),
                warn: sinon.stub().resolves()
            }
            const getInstancesStub = sinon.stub().resolves({ count: 1, projects: [{ id: PROJECT_ID, name: 'A-PROJECT' }] })
            InstancesApi.InstancesApi = sinon.stub().returns({
                getInstances: getInstancesStub
            })
            const topic = 'cloud/project-nodes-test/xxx'
            projectLinkPackage(RED)
            const NodeConstructor = env.nodes['project link out'].NodeConstructor
            NodeConstructor.call(outNode, { topic, mode: 'return', timeout: 1.5 })
            // wait for the on call to complete before checking status
            await outNode.on
            getInstancesStub.called.should.be.false()
        })
        it('project link in should show status of "invalid source" and emit a warn', async function () {
            const env = setup()
            const RED = env.RED
            const inNode = {
                on: sinon.fake(),
                type: 'project link in',
                status: sinon.fake(),
                warn: sinon.stub().resolves()
            }
            const getInstancesStub = sinon.stub().resolves({ count: 1, projects: [{ id: PROJECT_ID, name: 'A-PROJECT' }] })
            InstancesApi.InstancesApi = sinon.stub().returns({
                getInstances: getInstancesStub
            })
            const topic = 'cloud/project-nodes-test/xxx'
            projectLinkPackage(RED)
            const NodeConstructor = env.nodes['project link in'].NodeConstructor
            NodeConstructor.call(inNode, { topic, project: '00000000000000000000', broadcast: true, timeout: 1.5 })
            // let the getInstances check complete before checking status
            await flushPromises()
            inNode.status.calledOnce.should.be.true()
            inNode.status.args[0][0].should.have.property('fill', 'red')
            inNode.status.args[0][0].should.have.property('shape', 'dot')
            inNode.status.args[0][0].should.have.property('text', 'invalid source')
            inNode.warn.called.should.be.true()
            // search for the warning message
            inNode.warn.args.some(args => {
                return /Selected source '00000000000000000000' not found in FlowFuse/.test(args[0])
            }).should.be.true('Expected warn to be called with "Selected source \'00000000000000000000\' not found in FlowFuse"')
            getInstancesStub.calledOnce.should.be.true()
        })
        it('project link call should show status of "invalid target" and emit a warn', async function () {
            const env = setup()
            const RED = env.RED
            const callNode = {
                on: sinon.fake(),
                type: 'project link call',
                status: sinon.fake(),
                warn: sinon.stub().resolves()
            }
            const getInstancesStub = sinon.stub().resolves({ count: 1, projects: [{ id: PROJECT_ID, name: 'A-PROJECT' }] })
            InstancesApi.InstancesApi = sinon.stub().returns({
                getInstances: getInstancesStub
            })
            const topic = 'cloud/project-nodes-test/call'
            projectLinkPackage(RED)
            const NodeConstructor = env.nodes['project link call'].NodeConstructor
            NodeConstructor.call(callNode, { topic, project: '00000000000000000000', timeout: 1.5 })
            // let the getInstances check complete before checking status
            await flushPromises()
            callNode.status.calledOnce.should.be.true()
            callNode.status.args[0][0].should.have.property('fill', 'red')
            callNode.status.args[0][0].should.have.property('shape', 'dot')
            callNode.status.args[0][0].should.have.property('text', 'invalid target')
            callNode.warn.called.should.be.true()
            // search for the warning message
            callNode.warn.args.some(args => {
                return /Selected target '00000000000000000000' not found in FlowFuse/.test(args[0])
            }).should.be.true('Expected warn to be called with "Selected target \'00000000000000000000\' not found in FlowFuse"')
            getInstancesStub.calledOnce.should.be.true()
        })
        it('project link out should show status of "invalid target" and emit a warn', async function () {
            const env = setup()
            const RED = env.RED
            const outNode = {
                on: sinon.fake(),
                type: 'project link out',
                status: sinon.fake(),
                warn: sinon.stub().resolves()
            }
            const getInstancesStub = sinon.stub().resolves({ count: 1, projects: [{ id: PROJECT_ID, name: 'A-PROJECT' }] })
            InstancesApi.InstancesApi = sinon.stub().returns({
                getInstances: getInstancesStub
            })
            const topic = 'cloud/project-nodes-test/xxx'
            projectLinkPackage(RED)
            const NodeConstructor = env.nodes['project link out'].NodeConstructor
            NodeConstructor.call(outNode, { topic, project: '00000000000000000000', mode: 'link', broadcast: false, timeout: 1.5 })
            // let the getInstances check complete before checking status
            await flushPromises()
            outNode.status.calledOnce.should.be.true()
            outNode.status.args[0][0].should.have.property('fill', 'red')
            outNode.status.args[0][0].should.have.property('shape', 'dot')
            outNode.status.args[0][0].should.have.property('text', 'invalid target')
            outNode.warn.called.should.be.true()
            // search for the warning message
            outNode.warn.args.some(args => {
                return /Selected target '00000000000000000000' not found in FlowFuse/.test(args[0])
            }).should.be.true('Expected warn to be called with "Selected target \'00000000000000000000\' not found in FlowFuse"')
            getInstancesStub.calledOnce.should.be.true()
        })

        it('project link in should subscribe using shared sub in HA mode', function () {
            const env = setup({ haMode: true })
            const inNode = {
                on: sinon.fake(),
                type: 'project link in'
            }
            const topic = 'cloud/project-nodes-test/xxx'
            const RED = env.RED
            projectLinkPackage(RED)
            const NodeConstructor = env.nodes['project link in'].NodeConstructor
            NodeConstructor.call(inNode, { topic, project: PROJECT_ID, timeout: 1.5 })

            // Validate connect options
            const mqttConnectOptions = env.mqttConnectStub.args[0][0]
            mqttConnectOptions.should.have.property('username', 'test-username')
            mqttConnectOptions.should.have.property('password', 'test-password')
            mqttConnectOptions.should.have.property('clientId')
            mqttConnectOptions.clientId.should.have.lengthOf('test-username:n:ABCD'.length) // the suffix is always 4 chars
            mqttConnectOptions.clientId.should.startWith('test-username:n:')

            env.mqttStub.subscribe.calledOnce.should.be.true()
            should(env.mqttStub.subscribe.args[0][0]).equal(`$share/${PROJECT_ID}/ff/v1/${TEAM_ID}/p/${PROJECT_ID}/in/${topic}`)
            const options = env.mqttStub.subscribe.args[0][1]
            should(options).be.an.Object()
            options.should.have.property('qos').and.equal(2)
            options.should.have.property('properties').and.be.an.Object()
            options.properties.should.have.property('subscriptionIdentifier').and.be.a.Number()
        })
        it('project link call should use unique responseTopic in HA mode', async function () {
            const env = setup({ haMode: true })
            const RED = env.RED
            const nodeEvents = {}
            const callNode = {
                on: (event, cb) => {
                    nodeEvents[event] = cb
                },
                error: sinon.fake(),
                type: 'project link call'
            }
            const topic = 'cloud/project-nodes-test/call'
            const expectedPubTopic = `ff/v1/${TEAM_ID}/p/${PROJECT_ID}/in/${topic}`
            // In HA mode the response topic is prefixed with $share/<projectId> and has a random suffix
            projectLinkPackage(RED)
            const NodeConstructor = env.nodes['project link call'].NodeConstructor
            NodeConstructor.call(callNode, { topic, project: PROJECT_ID, timeout: 1.5 })
            callNode.should.have.property('topic', expectedPubTopic)
            callNode.should.have.property('responseTopic')
            callNode.responseTopic.should.startWith(`ff/v1/${TEAM_ID}/p/${PROJECT_ID}/res-`)
            callNode.responseTopic.should.endWith(`/${topic}`)

            env.mqttStub.subscribe.calledOnce.should.be.true()
            should(env.mqttStub.subscribe.args[0][0]).equal(callNode.responseTopic)
            const options = env.mqttStub.subscribe.args[0][1]
            should(options).be.an.Object()
            options.should.have.property('qos').and.equal(2)
        })
    })

    describe('Dynamic target', function () {
        const OTHER_ID = '12345678-5555-6666-7777-8888abcdef12'
        const DEVICE_ID = 'dev:abcdef'
        const topic = 'cloud/project-nodes-test/dynamic'
        const instances = [
            { id: PROJECT_ID, name: 'A-PROJECT' },
            { id: OTHER_ID, name: 'OTHER-PROJECT' },
            { id: DEVICE_ID, name: 'A-DEVICE', type: 'device' }
        ]

        function create (type, config, getInstancesStub) {
            const env = setup()
            const nodeEvents = {}
            const node = {
                on: (event, cb) => { nodeEvents[event] = cb },
                error: sinon.fake(),
                warn: sinon.fake(),
                status: sinon.fake(),
                type
            }
            const getInstances = getInstancesStub || sinon.stub().resolves({ count: instances.length, instances })
            InstancesApi.InstancesApi = sinon.stub().returns({ getInstances })
            projectLinkPackage(env.RED)
            env.nodes[type].NodeConstructor.call(node, { topic, timeout: 0.05, ...config })
            return { env, node, nodeEvents, getInstances }
        }

        afterEach(function () {
            delete process.env.TEST_LINK_TARGET
        })

        describe('project link out', function () {
            it('should send to the instance in a msg property', async function () {
                const { env, nodeEvents } = create('project link out', { mode: 'link', project: PROJECT_ID, targetType: 'msg', targetValue: 'target' })
                const done = sinon.fake()
                await nodeEvents.input({ payload: 'test', target: OTHER_ID }, sinon.fake(), done)
                done.calledOnceWithExactly().should.be.true()
                env.mqttStub.publish.calledOnce.should.be.true()
                env.mqttStub.publish.args[0][0].should.equal(`ff/v1/${TEAM_ID}/p/${OTHER_ID}/in/${topic}`)
            })
            it('should send to a different instance for each message', async function () {
                const { env, nodeEvents } = create('project link out', { mode: 'link', targetType: 'msg', targetValue: 'payload.to' })
                await nodeEvents.input({ payload: { to: OTHER_ID } }, sinon.fake(), sinon.fake())
                await nodeEvents.input({ payload: { to: PROJECT_ID } }, sinon.fake(), sinon.fake())
                env.mqttStub.publish.args.map(args => args[0]).should.eql([
                    `ff/v1/${TEAM_ID}/p/${OTHER_ID}/in/${topic}`,
                    `ff/v1/${TEAM_ID}/p/${PROJECT_ID}/in/${topic}`
                ])
            })
            it('should send to the instance in an environment variable', async function () {
                process.env.TEST_LINK_TARGET = OTHER_ID
                const { env, nodeEvents } = create('project link out', { mode: 'link', targetType: 'env', targetValue: 'TEST_LINK_TARGET' })
                await nodeEvents.input({ payload: 'test' }, sinon.fake(), sinon.fake())
                env.mqttStub.publish.args[0][0].should.equal(`ff/v1/${TEAM_ID}/p/${OTHER_ID}/in/${topic}`)
            })
            it('should send to a remote instance', async function () {
                const { env, nodeEvents } = create('project link out', { mode: 'link', targetType: 'msg', targetValue: 'target' })
                await nodeEvents.input({ payload: 'test', target: DEVICE_ID }, sinon.fake(), sinon.fake())
                env.mqttStub.publish.args[0][0].should.equal(`ff/v1/${TEAM_ID}/p/${DEVICE_ID}/in/${topic}`)
            })
            it('should not check the target when the node starts', function () {
                const { getInstances } = create('project link out', { mode: 'link', targetType: 'msg', targetValue: 'target' })
                getInstances.called.should.be.false()
            })
            it('should send without asking FlowFuse, even when it cannot be reached', async function () {
                const getInstances = sinon.stub().rejects(new Error('ECONNREFUSED'))
                const { env, nodeEvents } = create('project link out', { mode: 'link', targetType: 'msg', targetValue: 'target' }, getInstances)
                const done = sinon.fake()
                await nodeEvents.input({ payload: 'test', target: OTHER_ID }, sinon.fake(), done)
                done.calledOnceWithExactly().should.be.true()
                getInstances.called.should.be.false()
                env.mqttStub.publish.args[0][0].should.equal(`ff/v1/${TEAM_ID}/p/${OTHER_ID}/in/${topic}`)
            })
            for (const [name, msg] of [
                ['missing', { payload: 'test' }],
                ['not a string', { payload: 'test', target: 123 }],
                ['empty', { payload: 'test', target: '' }],
                ['not an instance id', { payload: 'test', target: 'a/b' }],
                ['a topic wildcard', { payload: 'test', target: '+' }],
                ['a remote instance without an id', { payload: 'test', target: 'dev:' }],
                ['not a full instance id', { payload: 'test', target: 'x-' }]
            ]) {
                it(`should error when the target is ${name}`, async function () {
                    const { env, nodeEvents } = create('project link out', { mode: 'link', targetType: 'msg', targetValue: 'target' })
                    const done = sinon.fake()
                    await nodeEvents.input(msg, sinon.fake(), done)
                    done.calledOnce.should.be.true()
                    done.args[0][0].should.be.an.Error()
                    done.args[0][0].message.should.match(/Invalid target: msg.target/)
                    env.mqttStub.publish.called.should.be.false()
                })
            }
            it('should ignore the target type when broadcasting', async function () {
                const { env, nodeEvents, getInstances } = create('project link out', { mode: 'link', broadcast: true, targetType: 'msg', targetValue: 'target' })
                const done = sinon.fake()
                await nodeEvents.input({ payload: 'test' }, sinon.fake(), done)
                done.calledOnceWithExactly().should.be.true()
                getInstances.called.should.be.false()
                env.mqttStub.publish.args[0][0].should.equal(`ff/v1/${TEAM_ID}/p/${PROJECT_ID}/out/${topic}`)
            })
            it('should still check a selected instance when the node starts', function () {
                const { getInstances } = create('project link out', { mode: 'link', project: PROJECT_ID })
                getInstances.called.should.be.true()
            })
        })

        describe('project link call', function () {
            it('should call the instance in a msg property', async function () {
                const { env, node, nodeEvents } = create('project link call', { targetType: 'msg', targetValue: 'target' })
                should(node.topic).be.null()
                // the response channel does not depend on the target
                node.responseTopic.should.equal(`ff/v1/${TEAM_ID}/p/${PROJECT_ID}/res/${topic}`)
                await nodeEvents.input({ payload: 'test', target: OTHER_ID }, sinon.fake(), sinon.fake())
                env.mqttStub.publish.calledOnce.should.be.true()
                env.mqttStub.publish.args[0][0].should.equal(`ff/v1/${TEAM_ID}/p/${OTHER_ID}/in/${topic}`)
                const pubMessage = JSON.parse(env.mqttStub.publish.args[0][1])
                pubMessage.projectLink.callStack.should.have.length(1)
                pubMessage.projectLink.callStack[0].should.have.property('response', 'res')
            })
            it('should call the instance in an environment variable', async function () {
                process.env.TEST_LINK_TARGET = DEVICE_ID
                const { env, nodeEvents } = create('project link call', { targetType: 'env', targetValue: 'TEST_LINK_TARGET' })
                await nodeEvents.input({ payload: 'test' }, sinon.fake(), sinon.fake())
                env.mqttStub.publish.args[0][0].should.equal(`ff/v1/${TEAM_ID}/p/${DEVICE_ID}/in/${topic}`)
            })
            it('should call without asking FlowFuse, even when it cannot be reached', async function () {
                const getInstances = sinon.stub().rejects(new Error('ECONNREFUSED'))
                const { env, nodeEvents } = create('project link call', { targetType: 'msg', targetValue: 'target' }, getInstances)
                await nodeEvents.input({ payload: 'test', target: OTHER_ID }, sinon.fake(), sinon.fake())
                getInstances.called.should.be.false()
                env.mqttStub.publish.args[0][0].should.equal(`ff/v1/${TEAM_ID}/p/${OTHER_ID}/in/${topic}`)
            })
            it('should name the dynamic target when a call times out', async function () {
                const { node, nodeEvents } = create('project link call', { targetType: 'msg', targetValue: 'target' })
                await nodeEvents.input({ payload: 'test', target: OTHER_ID }, sinon.fake(), sinon.fake())
                await new Promise(resolve => setTimeout(resolve, 150))
                node.error.calledOnce.should.be.true()
                node.error.args[0][0].should.match(new RegExp(`instance ${OTHER_ID}`))
            })
            it('should error without waiting for a response when the target is not an instance id', async function () {
                const { env, node, nodeEvents } = create('project link call', { targetType: 'msg', targetValue: 'target' })
                const done = sinon.fake()
                await nodeEvents.input({ payload: 'test', target: 'a/b' }, sinon.fake(), done)
                done.calledOnce.should.be.true()
                done.args[0][0].message.should.match(/Invalid target: msg.target/)
                env.mqttStub.publish.called.should.be.false()
                // no call is left waiting to time out
                await new Promise(resolve => setTimeout(resolve, 150))
                node.error.called.should.be.false()
            })
            it('should error when the target is missing', async function () {
                const { env, nodeEvents } = create('project link call', { targetType: 'msg', targetValue: 'target' })
                const done = sinon.fake()
                await nodeEvents.input({ payload: 'test' }, sinon.fake(), done)
                done.args[0][0].message.should.match(/Invalid target: msg.target/)
                env.mqttStub.publish.called.should.be.false()
            })
        })
    })

    describe('Dynamic topic', function () {
        const OTHER_ID = '12345678-5555-6666-7777-8888abcdef12'
        const instances = [
            { id: PROJECT_ID, name: 'A-PROJECT' },
            { id: OTHER_ID, name: 'OTHER-PROJECT' }
        ]

        function create (type, config) {
            const env = setup()
            const nodeEvents = {}
            const node = {
                on: (event, cb) => { nodeEvents[event] = cb },
                error: sinon.fake(),
                warn: sinon.fake(),
                status: sinon.fake(),
                receive: sinon.fake(),
                type
            }
            const getInstances = sinon.stub().resolves({ count: instances.length, instances })
            InstancesApi.InstancesApi = sinon.stub().returns({ getInstances })
            projectLinkPackage(env.RED)
            env.nodes[type].NodeConstructor.call(node, { timeout: 0.05, ...config })
            return { env, node, nodeEvents }
        }

        afterEach(function () {
            delete process.env.TEST_LINK_TOPIC
            delete process.env.TEST_LINK_DEVICE
        })

        describe('project link in', function () {
            it('should listen on a topic from an environment variable', function () {
                process.env.TEST_LINK_TOPIC = 'a/b'
                const { env, node } = create('project link in', { topicType: 'env', topic: 'TEST_LINK_TOPIC' })
                node.subTopic.should.equal('a/b')
                env.mqttStub.subscribe.args[0][0].should.equal(`ff/v1/${TEAM_ID}/p/${PROJECT_ID}/in/a/b`)
            })
            it('should listen on a topic built from an environment variable template', function () {
                process.env.TEST_LINK_DEVICE = 'device-1'
                const { env } = create('project link in', { topicType: 'env', topic: 'some/topic/${TEST_LINK_DEVICE}/status' })
                env.mqttStub.subscribe.args[0][0].should.equal(`ff/v1/${TEAM_ID}/p/${PROJECT_ID}/in/some/topic/device-1/status`)
            })
            it('should still listen on a topic that was entered', function () {
                const { env } = create('project link in', { topic: 'a/b' })
                env.mqttStub.subscribe.args[0][0].should.equal(`ff/v1/${TEAM_ID}/p/${PROJECT_ID}/in/a/b`)
            })
            for (const [name, topic] of [
                ['not set', '${TEST_LINK_DEVICE}/status'],
                ['not set when part of a name', 'a/device-${TEST_LINK_DEVICE}'],
                ['not set when it is the whole topic', 'TEST_LINK_DEVICE']
            ]) {
                it(`should not subscribe when the environment variable is ${name}`, function () {
                    const { env, node } = create('project link in', { topicType: 'env', topic })
                    env.mqttStub.subscribe.called.should.be.false()
                    node.error.calledOnce.should.be.true()
                    node.error.args[0][0].should.match(/'TEST_LINK_DEVICE' is not set/)
                    node.status.lastCall.args[0].should.have.property('text', 'invalid topic')
                })
            }
            it('should not subscribe when the topic is not valid', function () {
                process.env.TEST_LINK_TOPIC = 'a/+/b'
                const { env, node } = create('project link in', { topicType: 'env', topic: 'TEST_LINK_TOPIC' })
                env.mqttStub.subscribe.called.should.be.false()
                node.error.args[0][0].should.match(/Invalid topic: env.TEST_LINK_TOPIC/)
            })
            it('should not subscribe when the topic is read from a msg', function () {
                const { env, node } = create('project link in', { topicType: 'msg', topic: 'topic' })
                env.mqttStub.subscribe.called.should.be.false()
                node.error.args[0][0].should.match(/cannot be used to receive messages/)
            })
        })

        describe('project link out', function () {
            it('should send on the topic in a msg property', async function () {
                const { env, nodeEvents } = create('project link out', { mode: 'link', project: OTHER_ID, topicType: 'msg', topic: 'topic' })
                const done = sinon.fake()
                await nodeEvents.input({ payload: 'test', topic: 'x/y' }, sinon.fake(), done)
                done.calledOnceWithExactly().should.be.true()
                env.mqttStub.publish.args[0][0].should.equal(`ff/v1/${TEAM_ID}/p/${OTHER_ID}/in/x/y`)
            })
            it('should send on a different topic for each message', async function () {
                const { env, nodeEvents } = create('project link out', { mode: 'link', broadcast: true, topicType: 'msg', topic: 'payload.to' })
                await nodeEvents.input({ payload: { to: 'a/b' } }, sinon.fake(), sinon.fake())
                await nodeEvents.input({ payload: { to: 'c' } }, sinon.fake(), sinon.fake())
                env.mqttStub.publish.args.map(args => args[0]).should.eql([
                    `ff/v1/${TEAM_ID}/p/${PROJECT_ID}/out/a/b`,
                    `ff/v1/${TEAM_ID}/p/${PROJECT_ID}/out/c`
                ])
            })
            it('should send on the topic in an environment variable template', async function () {
                process.env.TEST_LINK_DEVICE = 'device-1'
                const { env, nodeEvents } = create('project link out', { mode: 'link', project: OTHER_ID, topicType: 'env', topic: 'some/${TEST_LINK_DEVICE}/status' })
                await nodeEvents.input({ payload: 'test' }, sinon.fake(), sinon.fake())
                env.mqttStub.publish.args[0][0].should.equal(`ff/v1/${TEAM_ID}/p/${OTHER_ID}/in/some/device-1/status`)
            })
            it('should send to a dynamic target on a dynamic topic', async function () {
                const { env, nodeEvents } = create('project link out', { mode: 'link', targetType: 'msg', targetValue: 'target', topicType: 'msg', topic: 'topic' })
                await nodeEvents.input({ payload: 'test', target: OTHER_ID, topic: 'x/y' }, sinon.fake(), sinon.fake())
                env.mqttStub.publish.args[0][0].should.equal(`ff/v1/${TEAM_ID}/p/${OTHER_ID}/in/x/y`)
            })
            for (const [name, msg] of [
                ['missing', { payload: 'test' }],
                ['not a string', { payload: 'test', topic: 123 }],
                ['empty', { payload: 'test', topic: '' }],
                ['a wildcard', { payload: 'test', topic: 'a/#' }],
                ['a single level wildcard', { payload: 'test', topic: 'a/+/b' }],
                ['a system topic', { payload: 'test', topic: '$SYS/a' }],
                ['an empty level', { payload: 'test', topic: 'a//b' }],
                ['a leading slash', { payload: 'test', topic: '/a' }]
            ]) {
                it(`should error when the topic is ${name}`, async function () {
                    const { env, nodeEvents } = create('project link out', { mode: 'link', project: OTHER_ID, topicType: 'msg', topic: 'topic' })
                    const done = sinon.fake()
                    await nodeEvents.input(msg, sinon.fake(), done)
                    done.calledOnce.should.be.true()
                    done.args[0][0].message.should.match(/Invalid topic: msg.topic/)
                    env.mqttStub.publish.called.should.be.false()
                })
            }
            it('should error when an environment variable in the topic is not set', async function () {
                const { env, nodeEvents } = create('project link out', { mode: 'link', project: OTHER_ID, topicType: 'env', topic: 'a/device-${TEST_LINK_DEVICE}' })
                const done = sinon.fake()
                await nodeEvents.input({ payload: 'test' }, sinon.fake(), done)
                done.args[0][0].message.should.match(/environment variable 'TEST_LINK_DEVICE' is not set/)
                env.mqttStub.publish.called.should.be.false()
            })
            it('should ignore the topic type when returning a call', async function () {
                const { env, nodeEvents } = create('project link out', { mode: 'return', topicType: 'msg', topic: 'topic' })
                const msg = { payload: 'test', projectLink: { callStack: [{ project: OTHER_ID, topic: 'x/y', eventId: 'e1', response: 'res' }] } }
                const done = sinon.fake()
                await nodeEvents.input(msg, sinon.fake(), done)
                done.calledOnceWithExactly().should.be.true()
                env.mqttStub.publish.args[0][0].should.equal(`ff/v1/${TEAM_ID}/p/${OTHER_ID}/res/x/y`)
            })
        })

        describe('project link call', function () {
            it('should listen for every response sent to it', function () {
                const { env, node } = create('project link call', { project: OTHER_ID, topicType: 'msg', topic: 'topic' })
                should(node.topic).be.null()
                node.responseTopic.should.equal(`ff/v1/${TEAM_ID}/p/${PROJECT_ID}/res/+/#`)
                env.mqttStub.subscribe.args[0][0].should.equal(`ff/v1/${TEAM_ID}/p/${PROJECT_ID}/res/+/#`)
            })
            it('should listen for the response to a topic that was entered', function () {
                const { env } = create('project link call', { project: OTHER_ID, topic: 'a/b' })
                env.mqttStub.subscribe.args[0][0].should.equal(`ff/v1/${TEAM_ID}/p/${PROJECT_ID}/res/a/b`)
            })
            it('should listen for the responses of this node only in HA mode', function () {
                const env = setup({ haMode: true })
                InstancesApi.InstancesApi = sinon.stub().returns({ getInstances: sinon.stub().resolves({ count: 0, instances: [] }) })
                projectLinkPackage(env.RED)
                const node = { on: sinon.fake(), error: sinon.fake(), warn: sinon.fake(), status: sinon.fake(), type: 'project link call' }
                env.nodes['project link call'].NodeConstructor.call(node, { project: OTHER_ID, topicType: 'msg', topic: 'topic' })
                node.responseTopic.should.match(new RegExp(`^ff/v1/${TEAM_ID}/p/${PROJECT_ID}/res-[0-9a-f]{8}/\\+/#$`))
            })
            it('should call on the topic in a msg property', async function () {
                const { env, nodeEvents } = create('project link call', { project: OTHER_ID, topicType: 'msg', topic: 'topic' })
                await nodeEvents.input({ payload: 'test', topic: 'x/y' }, sinon.fake(), sinon.fake())
                env.mqttStub.publish.args[0][0].should.equal(`ff/v1/${TEAM_ID}/p/${OTHER_ID}/in/x/y`)
                const pubMessage = JSON.parse(env.mqttStub.publish.args[0][1])
                pubMessage.projectLink.callStack[0].should.have.property('topic', 'x/y')
            })
            it('should call on the topic in an environment variable template', async function () {
                process.env.TEST_LINK_DEVICE = 'device-1'
                const { env, nodeEvents } = create('project link call', { project: OTHER_ID, topicType: 'env', topic: 'some/${TEST_LINK_DEVICE}/status' })
                await nodeEvents.input({ payload: 'test' }, sinon.fake(), sinon.fake())
                env.mqttStub.publish.args[0][0].should.equal(`ff/v1/${TEAM_ID}/p/${OTHER_ID}/in/some/device-1/status`)
            })
            it('should send the response of a call on any topic to the message that made the call', async function () {
                const { env, nodeEvents } = create('project link call', { project: OTHER_ID, topicType: 'msg', topic: 'topic' })
                const send = sinon.fake()
                const done = sinon.fake()
                await nodeEvents.input({ payload: 'test', topic: 'x/y' }, send, done)
                const sent = JSON.parse(env.mqttStub.publish.args[0][1])
                const eventId = sent.projectLink.callStack[0].eventId
                // the response arrives on the topic that was called, which only the wildcard subscription matches
                const onMessage = env.mqttStub.on.args.find(args => args[0] === 'message')[1]
                const response = Buffer.from(JSON.stringify({ payload: 'reply', projectLink: {} }))
                onMessage(`ff/v1/${TEAM_ID}/p/${PROJECT_ID}/res/x/y`, response, { properties: { correlationData: Buffer.from(eventId) } })
                send.calledOnce.should.be.true()
                send.args[0][0].should.have.property('payload', 'reply')
                done.calledOnce.should.be.true()
            })
            it('should keep receiving responses when another call node with a dynamic topic is closed', async function () {
                const env = setup()
                InstancesApi.InstancesApi = sinon.stub().returns({ getInstances: sinon.stub().resolves({ count: 0, instances: [] }) })
                projectLinkPackage(env.RED)
                const make = () => {
                    const events = {}
                    const node = { on: (event, cb) => { events[event] = cb }, error: sinon.fake(), warn: sinon.fake(), status: sinon.fake(), type: 'project link call' }
                    env.nodes['project link call'].NodeConstructor.call(node, { project: OTHER_ID, topicType: 'msg', topic: 'topic', timeout: 0.05 })
                    return events
                }
                const first = make()
                const second = make()
                const send = sinon.fake()
                await first.input({ payload: 'test', topic: 'x/y' }, send, sinon.fake())
                const eventId = JSON.parse(env.mqttStub.publish.args[0][1]).projectLink.callStack[0].eventId
                await new Promise(resolve => second.close(resolve))
                // the filter is still needed by the first node
                env.mqttStub.unsubscribe.called.should.be.false()
                const onMessage = env.mqttStub.on.args.find(args => args[0] === 'message')[1]
                const response = Buffer.from(JSON.stringify({ payload: 'reply', projectLink: {} }))
                onMessage(`ff/v1/${TEAM_ID}/p/${PROJECT_ID}/res/x/y`, response, { properties: { correlationData: Buffer.from(eventId) } })
                send.calledOnce.should.be.true()
                send.args[0][0].should.have.property('payload', 'reply')
            })
            it('should ignore a response to another call', async function () {
                const { env, nodeEvents } = create('project link call', { project: OTHER_ID, topicType: 'msg', topic: 'topic' })
                const send = sinon.fake()
                await nodeEvents.input({ payload: 'test', topic: 'x/y' }, send, sinon.fake())
                const onMessage = env.mqttStub.on.args.find(args => args[0] === 'message')[1]
                const response = Buffer.from(JSON.stringify({ payload: 'reply', projectLink: {} }))
                onMessage(`ff/v1/${TEAM_ID}/p/${PROJECT_ID}/res/x/y`, response, { properties: { correlationData: Buffer.from('another') } })
                send.called.should.be.false()
            })
            it('should name the dynamic topic when a call times out', async function () {
                const { node, nodeEvents } = create('project link call', { project: OTHER_ID, topicType: 'msg', topic: 'topic' })
                await nodeEvents.input({ payload: 'test', topic: 'x/y' }, sinon.fake(), sinon.fake())
                await new Promise(resolve => setTimeout(resolve, 150))
                node.error.calledOnce.should.be.true()
                node.error.args[0][0].should.match(/on topic 'x\/y'/)
            })
            it('should error without waiting for a response when the topic is not valid', async function () {
                const { env, node, nodeEvents } = create('project link call', { project: OTHER_ID, topicType: 'msg', topic: 'topic' })
                const done = sinon.fake()
                await nodeEvents.input({ payload: 'test', topic: 'a/#' }, sinon.fake(), done)
                done.args[0][0].message.should.match(/Invalid topic: msg.topic/)
                env.mqttStub.publish.called.should.be.false()
                await new Promise(resolve => setTimeout(resolve, 150))
                node.error.called.should.be.false()
            })
        })
    })

    describe('Application aware', function () {
        const APPLICATION_ID = 'app-1'
        const DEVICE_ID = 'device-1'
        const OTHER_DEVICE = 'dev:device-2'

        afterEach(function () {
            delete process.env.FF_DEVICE_ID
        })

        /** Make the runtime look like a remote instance assigned to an application */
        function asApplicationDevice (env) {
            delete env.RED.settings.flowforge.projectID
            env.RED.settings.flowforge.applicationID = APPLICATION_ID
            process.env.FF_DEVICE_ID = DEVICE_ID
        }

        function stubInstances (data) {
            const getInstancesStub = sinon.stub().resolves({
                count: 0,
                instances: [],
                applications: [],
                self: null,
                supportsApplications: true,
                ...data
            })
            InstancesApi.InstancesApi = sinon.stub().returns({ getInstances: getInstancesStub })
            return getInstancesStub
        }

        function createNode (env, type, config, extra) {
            const nodeEvents = {}
            const node = {
                on: (event, cb) => { nodeEvents[event] = cb },
                type,
                status: sinon.fake(),
                warn: sinon.fake(),
                error: sinon.fake(),
                receive: sinon.fake(),
                ...extra
            }
            projectLinkPackage(env.RED)
            env.nodes[type].NodeConstructor.call(node, config)
            return { node, nodeEvents }
        }

        it('project link in on an application owned device can receive direct messages', function () {
            const env = setup()
            asApplicationDevice(env)
            stubInstances()
            const topic = 'direct/topic'
            const { node } = createNode(env, 'project link in', { topic, broadcast: false })
            node.status.calledWithMatch({ text: 'unsupported source option' }).should.be.false()
            env.mqttStub.subscribe.calledOnce.should.be.true()
            should(env.mqttStub.subscribe.args[0][0]).equal(`ff/v1/${TEAM_ID}/p/dev:${DEVICE_ID}/in/${topic}`)
        })

        it('project link in subscribes to application broadcasts from all sources', async function () {
            const env = setup()
            asApplicationDevice(env)
            const getInstancesStub = stubInstances()
            const topic = 'app/topic'
            createNode(env, 'project link in', { topic, broadcast: true, project: 'all', scope: 'application' })
            await flushPromises()
            env.mqttStub.subscribe.calledOnce.should.be.true()
            should(env.mqttStub.subscribe.args[0][0]).equal(`ff/v1/${TEAM_ID}/a/${APPLICATION_ID}/p/+/out/${topic}`)
            env.mqttStub.subscribe.args[0][1].properties.should.have.property('subscriptionIdentifier', 2)
            // application id is known from settings, but platform support must still be confirmed
            getInstancesStub.calledOnce.should.be.true()
        })

        it('project link in subscribes to application broadcasts saved as broadcast "application"', async function () {
            const env = setup()
            asApplicationDevice(env)
            stubInstances()
            const topic = 'app/topic'
            createNode(env, 'project link in', { topic, broadcast: 'application', project: 'all', scope: 'application' })
            await flushPromises()
            env.mqttStub.subscribe.calledOnce.should.be.true()
            should(env.mqttStub.subscribe.args[0][0]).equal(`ff/v1/${TEAM_ID}/a/${APPLICATION_ID}/p/+/out/${topic}`)
            env.mqttStub.subscribe.args[0][1].properties.should.have.property('subscriptionIdentifier', 2)
        })

        it('project link in treats broadcast "application" as application scope even without a scope', async function () {
            const env = setup()
            asApplicationDevice(env)
            stubInstances()
            const topic = 'app/topic'
            createNode(env, 'project link in', { topic, broadcast: 'application', project: 'all' })
            await flushPromises()
            should(env.mqttStub.subscribe.args[0][0]).equal(`ff/v1/${TEAM_ID}/a/${APPLICATION_ID}/p/+/out/${topic}`)
        })

        it('project link in on a device reports an error when the platform does not support application scope', async function () {
            const env = setup()
            asApplicationDevice(env)
            stubInstances({ supportsApplications: false })
            const { node } = createNode(env, 'project link in', { topic: 'app/topic', broadcast: true, project: 'all', scope: 'application' })
            await flushPromises()
            env.mqttStub.subscribe.called.should.be.false()
            node.status.calledWithMatch({ text: 'subscribe error' }).should.be.true()
            node.error.args[0][0].message.should.match(/not supported by this version of FlowFuse/)
        })

        it('project link in on a hosted instance learns its application from the platform', async function () {
            const env = setup()
            stubInstances({
                self: { id: PROJECT_ID, applicationId: APPLICATION_ID },
                instances: [{ id: 'other-instance', name: 'Other', type: 'instance', applicationId: APPLICATION_ID }]
            })
            const topic = 'app/topic'
            createNode(env, 'project link in', { topic, broadcast: true, project: 'other-instance', scope: 'application' })
            await flushPromises()
            env.mqttStub.subscribe.calledOnce.should.be.true()
            should(env.mqttStub.subscribe.args[0][0]).equal(`ff/v1/${TEAM_ID}/a/${APPLICATION_ID}/p/other-instance/out/${topic}`)
        })

        it('project link in reports an error when the platform does not support application scope', async function () {
            const env = setup()
            stubInstances({ supportsApplications: false })
            const { node } = createNode(env, 'project link in', { topic: 'app/topic', broadcast: true, project: 'all', scope: 'application' })
            await flushPromises()
            env.mqttStub.subscribe.called.should.be.false()
            node.status.calledWithMatch({ text: 'subscribe error' }).should.be.true()
            node.error.args[0][0].message.should.match(/not supported by this version of FlowFuse/)
        })

        it('project link in warns when a specific source is not in this application', async function () {
            const env = setup()
            stubInstances({
                self: { id: PROJECT_ID, applicationId: APPLICATION_ID },
                instances: [{ id: 'other-instance', name: 'Other', type: 'instance', applicationId: 'another-app' }]
            })
            const { node } = createNode(env, 'project link in', { topic: 'app/topic', broadcast: true, project: 'other-instance', scope: 'application' })
            await flushPromises()
            node.status.calledWithMatch({ text: 'invalid source' }).should.be.true()
            node.warn.args.some(args => /is not in this application/.test(args[0])).should.be.true()
        })

        it('project link in delivers application broadcasts received from any source', async function () {
            const env = setup()
            asApplicationDevice(env)
            stubInstances()
            const topic = 'app/topic'
            const { node } = createNode(env, 'project link in', { topic, broadcast: true, project: 'all', scope: 'application' })
            await flushPromises()
            const onMessage = env.mqttStub.on.args.find(args => args[0] === 'message')[1]
            const packet = {
                properties: {
                    subscriptionIdentifier: 2,
                    userProperties: { _projectID: 'source-instance', _applicationID: APPLICATION_ID }
                }
            }
            onMessage(`ff/v1/${TEAM_ID}/a/${APPLICATION_ID}/p/source-instance/out/${topic}`, Buffer.from(JSON.stringify({ payload: 'hello' })), packet)
            node.receive.calledOnce.should.be.true()
            const msg = node.receive.args[0][0]
            msg.should.have.property('payload', 'hello')
            msg.projectLink.should.have.property('topic', topic)
            msg.projectLink.should.have.property('scope', 'application')
            msg.projectLink.should.have.property('instanceId', 'source-instance')
            msg.projectLink.should.have.property('applicationId', APPLICATION_ID)
        })

        it('project link out publishes application scoped broadcasts', async function () {
            const env = setup()
            asApplicationDevice(env)
            stubInstances()
            const topic = 'app/topic'
            const { nodeEvents } = createNode(env, 'project link out', { topic, mode: 'link', broadcast: true, scope: 'application' })
            await flushPromises()
            const done = sinon.fake()
            await nodeEvents.input({ payload: 'test' }, sinon.fake(), done)
            done.calledOnce.should.be.true()
            should(done.args[0][0]).be.undefined()
            env.mqttStub.publish.calledOnce.should.be.true()
            should(env.mqttStub.publish.args[0][0]).equal(`ff/v1/${TEAM_ID}/a/${APPLICATION_ID}/p/dev:${DEVICE_ID}/out/${topic}`)
            env.mqttStub.publish.args[0][2].properties.userProperties.should.have.property('_applicationID', APPLICATION_ID)
        })

        it('project link out publishes application broadcasts saved as broadcast "application"', async function () {
            const env = setup()
            asApplicationDevice(env)
            stubInstances()
            const topic = 'app/topic'
            const { nodeEvents } = createNode(env, 'project link out', { topic, mode: 'link', broadcast: 'application', scope: 'application' })
            await flushPromises()
            await nodeEvents.input({ payload: 'test' }, sinon.fake(), sinon.fake())
            should(env.mqttStub.publish.args[0][0]).equal(`ff/v1/${TEAM_ID}/a/${APPLICATION_ID}/p/dev:${DEVICE_ID}/out/${topic}`)
        })

        it('project link out treats broadcast "application" as application scope even without a scope', async function () {
            const env = setup()
            asApplicationDevice(env)
            stubInstances()
            const topic = 'app/topic'
            const { nodeEvents } = createNode(env, 'project link out', { topic, mode: 'link', broadcast: 'application' })
            await flushPromises()
            await nodeEvents.input({ payload: 'test' }, sinon.fake(), sinon.fake())
            should(env.mqttStub.publish.args[0][0]).equal(`ff/v1/${TEAM_ID}/a/${APPLICATION_ID}/p/dev:${DEVICE_ID}/out/${topic}`)
        })

        it('project link out keeps team scope by default', async function () {
            const env = setup()
            stubInstances()
            const topic = 'team/topic'
            const { nodeEvents } = createNode(env, 'project link out', { topic, mode: 'link', broadcast: true })
            await nodeEvents.input({ payload: 'test' }, sinon.fake(), sinon.fake())
            should(env.mqttStub.publish.args[0][0]).equal(`ff/v1/${TEAM_ID}/p/${PROJECT_ID}/out/${topic}`)
        })

        it('project link out can send to an application owned device', async function () {
            const env = setup()
            stubInstances({ instances: [{ id: OTHER_DEVICE, name: 'Device 2', type: 'device', applicationId: APPLICATION_ID }] })
            const topic = 'direct/topic'
            const { node, nodeEvents } = createNode(env, 'project link out', { topic, mode: 'link', broadcast: false, project: OTHER_DEVICE })
            await flushPromises()
            node.warn.called.should.be.false()
            await nodeEvents.input({ payload: 'test' }, sinon.fake(), sinon.fake())
            should(env.mqttStub.publish.args[0][0]).equal(`ff/v1/${TEAM_ID}/p/${OTHER_DEVICE}/in/${topic}`)
        })

        it('project link call can target an application owned device', async function () {
            const env = setup()
            stubInstances({ instances: [{ id: OTHER_DEVICE, name: 'Device 2', type: 'device', applicationId: APPLICATION_ID }] })
            const topic = 'call/topic'
            const { node } = createNode(env, 'project link call', { topic, project: OTHER_DEVICE, timeout: 1 })
            await flushPromises()
            node.warn.called.should.be.false()
            node.should.have.property('topic', `ff/v1/${TEAM_ID}/p/${OTHER_DEVICE}/in/${topic}`)
            node.should.have.property('responseTopic', `ff/v1/${TEAM_ID}/p/${PROJECT_ID}/res/${topic}`)
        })

        it('reports a subscribe error when the broker refuses the subscription', async function () {
            const env = setup()
            asApplicationDevice(env)
            stubInstances()
            env.mqttStub.subscribe = sinon.fake((topic, _options, callback) => callback(null, [{ topic, qos: 135 }]))
            const { node } = createNode(env, 'project link in', { topic: 'direct/topic', broadcast: false })
            await flushPromises()
            node.status.calledWithMatch({ text: 'subscribe error' }).should.be.true()
            node.error.args[0][0].message.should.match(/not permitted/)
        })

        it('reports a subscribe error when mqtt.js returns the refusal as an error', async function () {
            const env = setup()
            asApplicationDevice(env)
            stubInstances()
            env.mqttStub.subscribe = sinon.fake((topic, _options, callback) => {
                const err = new Error('Subscribe error: Not authorized')
                err.code = 135
                callback(err, [{ topic, qos: 135 }])
            })
            const { node } = createNode(env, 'project link in', { topic: 'direct/topic', broadcast: false })
            await flushPromises()
            node.status.calledWithMatch({ text: 'subscribe error' }).should.be.true()
            node.error.args[0][0].message.should.match(/not permitted/)
        })

        it('reports other subscribe errors as they are', async function () {
            const env = setup()
            stubInstances()
            env.mqttStub.subscribe = sinon.fake((_topic, _options, callback) => callback(new Error('Connection closed')))
            const { node } = createNode(env, 'project link in', { topic: 'direct/topic', broadcast: false })
            await flushPromises()
            node.status.calledWithMatch({ text: 'subscribe error' }).should.be.true()
            node.error.args[0][0].message.should.equal('Connection closed')
        })

        it('project link in unsubscribes a shared subscription when closed (HA)', async function () {
            const env = setup({ haMode: true })
            stubInstances()
            env.mqttStub.subscribe = sinon.fake((topic, _options, callback) => callback(null, [{ topic, qos: 2 }]))
            const { nodeEvents } = createNode(env, 'project link in', { topic: 'direct/topic', broadcast: false })
            await flushPromises()
            const subscribedTopic = env.mqttStub.subscribe.args[0][0]
            subscribedTopic.should.startWith(`$share/${PROJECT_ID}/`)

            nodeEvents.close(sinon.fake())
            await flushPromises()
            env.mqttStub.unsubscribe.calledOnce.should.be.true()
            env.mqttStub.unsubscribe.args[0][0].should.equal(subscribedTopic)
        })

        it('project link in treats broadcast "false" (string) as a direct subscription', async function () {
            const env = setup()
            stubInstances()
            const topic = 'direct/topic'
            createNode(env, 'project link in', { topic, broadcast: 'false', project: 'all' })
            await flushPromises()
            should(env.mqttStub.subscribe.args[0][0]).equal(`ff/v1/${TEAM_ID}/p/${PROJECT_ID}/in/${topic}`)
            env.mqttStub.subscribe.args[0][1].properties.should.have.property('subscriptionIdentifier', 1)
        })

        it('project link out on a hosted instance sends the application it learns from the platform', async function () {
            const env = setup()
            stubInstances({ self: { id: PROJECT_ID, applicationId: APPLICATION_ID } })
            const topic = 'team/topic'
            const { nodeEvents } = createNode(env, 'project link out', { topic, mode: 'link', broadcast: true })
            const onConnect = env.mqttStub.on.args.find(args => args[0] === 'connect')[1]
            onConnect({ properties: {} })
            await flushPromises()
            await nodeEvents.input({ payload: 'test' }, sinon.fake(), sinon.fake())
            should(env.mqttStub.publish.args[0][0]).equal(`ff/v1/${TEAM_ID}/p/${PROJECT_ID}/out/${topic}`)
            env.mqttStub.publish.args[0][2].properties.userProperties.should.have.property('_applicationID', APPLICATION_ID)
        })

        describe('when FlowFuse cannot be reached', function () {
            const topic = 'app/topic'
            const appTopic = `ff/v1/${TEAM_ID}/a/${APPLICATION_ID}/p/+/out/${topic}`
            const inConfig = { topic, broadcast: true, project: 'all', scope: 'application' }
            let clock

            beforeEach(function () {
                clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
            })
            afterEach(function () {
                clock.restore()
            })

            /** getInstances fails the first `failures` times, then returns the application data */
            function stubUnreachable (failures) {
                const getInstancesStub = stubInstances()
                for (let i = 0; i < failures; i++) {
                    getInstancesStub.onCall(i).rejects(new Error('connect ECONNREFUSED'))
                }
                return getInstancesStub
            }

            it('project link in waits and retries until the application is known', async function () {
                const env = setup()
                asApplicationDevice(env)
                const getInstancesStub = stubUnreachable(2)
                const { node } = createNode(env, 'project link in', inConfig)
                await flushPromises()
                env.mqttStub.subscribe.called.should.be.false()
                node.status.calledWithMatch({ fill: 'yellow', text: 'waiting for FlowFuse' }).should.be.true()
                node.error.called.should.be.false()

                await clock.tickAsync(35 * 1000) // first retry: 30s +/- 5s
                await flushPromises()
                getInstancesStub.callCount.should.equal(2)
                env.mqttStub.subscribe.called.should.be.false()

                await clock.tickAsync(66 * 1000) // second retry: 60s +/- 6s
                await flushPromises()
                getInstancesStub.callCount.should.equal(3)
                env.mqttStub.subscribe.calledOnce.should.be.true()
                should(env.mqttStub.subscribe.args[0][0]).equal(appTopic)
                node.warn.callCount.should.equal(1) // warns once, not on every retry
            })

            it('project link in warns with the error code when the error has no message', async function () {
                const env = setup()
                asApplicationDevice(env)
                const getInstancesStub = stubInstances()
                getInstancesStub.onCall(0).rejects(Object.assign(new Error(''), { code: 'ECONNREFUSED' }))
                const { node } = createNode(env, 'project link in', inConfig)
                await flushPromises()
                node.warn.args[0][0].should.endWith('will keep retrying: ECONNREFUSED')
            })

            it('project link in retries straight away when the MQTT client connects', async function () {
                const env = setup()
                asApplicationDevice(env)
                const getInstancesStub = stubUnreachable(1)
                createNode(env, 'project link in', inConfig)
                await flushPromises()
                env.mqttStub.subscribe.called.should.be.false()

                const onConnect = env.mqttStub.on.args.find(args => args[0] === 'connect')[1]
                onConnect({ properties: {} })
                await flushPromises()
                getInstancesStub.callCount.should.equal(2)
                env.mqttStub.subscribe.calledOnce.should.be.true()
                should(env.mqttStub.subscribe.args[0][0]).equal(appTopic)
            })

            it('project link in nodes share one lookup', async function () {
                const env = setup()
                asApplicationDevice(env)
                const getInstancesStub = stubUnreachable(1)
                createNode(env, 'project link in', inConfig)
                // second node from the same runtime (createNode loads the package again)
                const secondNode = { on: sinon.fake(), type: 'project link in', status: sinon.fake(), warn: sinon.fake(), error: sinon.fake() }
                env.nodes['project link in'].NodeConstructor.call(secondNode, { ...inConfig, topic: 'other/topic' })
                await flushPromises()
                getInstancesStub.callCount.should.equal(1)

                await clock.tickAsync(35 * 1000)
                await flushPromises()
                getInstancesStub.callCount.should.equal(2)
                env.mqttStub.subscribe.callCount.should.equal(2)
            })

            it('project link in does not subscribe when closed while the lookup is running', async function () {
                const env = setup()
                asApplicationDevice(env)
                const getInstancesStub = stubInstances()
                let finish
                getInstancesStub.onCall(0).returns(new Promise(resolve => { finish = resolve }))
                const { nodeEvents } = createNode(env, 'project link in', inConfig)
                await flushPromises()
                nodeEvents.close(sinon.fake())
                finish({ count: 0, instances: [], applications: [], self: null, supportsApplications: true })
                await flushPromises()
                env.mqttStub.subscribe.called.should.be.false()
            })

            it('project link in stops retrying when closed', async function () {
                const env = setup()
                asApplicationDevice(env)
                const getInstancesStub = stubUnreachable(1)
                const { nodeEvents } = createNode(env, 'project link in', inConfig)
                await flushPromises()
                nodeEvents.close(sinon.fake())

                await clock.tickAsync(10 * 60 * 1000)
                await flushPromises()
                getInstancesStub.callCount.should.equal(1)
                env.mqttStub.subscribe.called.should.be.false()
            })

            describe('project link out with application scope', function () {
                const outConfig = { topic, mode: 'link', broadcast: true, scope: 'application' }
                const outTopic = `ff/v1/${TEAM_ID}/a/${APPLICATION_ID}/p/dev:${DEVICE_ID}/out/${topic}`

                it('waits and retries until the application is known', async function () {
                    const env = setup()
                    asApplicationDevice(env)
                    const getInstancesStub = stubUnreachable(2)
                    const { node, nodeEvents } = createNode(env, 'project link out', outConfig)
                    await flushPromises()
                    node.status.calledWithMatch({ fill: 'yellow', text: 'waiting for FlowFuse' }).should.be.true()
                    node.warn.callCount.should.equal(1)

                    await clock.tickAsync(35 * 1000)
                    await flushPromises()
                    getInstancesStub.callCount.should.equal(2)
                    await clock.tickAsync(66 * 1000)
                    await flushPromises()
                    getInstancesStub.callCount.should.equal(3)
                    node.status.lastCall.calledWithMatch({}).should.be.true()
                    node.warn.callCount.should.equal(1)

                    // sending uses the stored values and makes no request
                    await nodeEvents.input({ payload: 'test' }, sinon.fake(), sinon.fake())
                    getInstancesStub.callCount.should.equal(3)
                    should(env.mqttStub.publish.args[0][0]).equal(outTopic)
                })

                it('makes no request when sending once the application is known', async function () {
                    const env = setup()
                    asApplicationDevice(env)
                    const getInstancesStub = stubInstances()
                    const { nodeEvents } = createNode(env, 'project link out', outConfig)
                    await flushPromises()
                    getInstancesStub.callCount.should.equal(1)
                    await nodeEvents.input({ payload: 'one' }, sinon.fake(), sinon.fake())
                    await nodeEvents.input({ payload: 'two' }, sinon.fake(), sinon.fake())
                    getInstancesStub.callCount.should.equal(1)
                    env.mqttStub.publish.callCount.should.equal(2)
                })

                it('waits for the start up lookup when a message is sent while it is running', async function () {
                    const env = setup()
                    asApplicationDevice(env)
                    const getInstancesStub = stubInstances()
                    let finish
                    getInstancesStub.onCall(0).returns(new Promise(resolve => { finish = resolve }))
                    const { nodeEvents } = createNode(env, 'project link out', outConfig)
                    const done = sinon.fake()
                    const sending = nodeEvents.input({ payload: 'test' }, sinon.fake(), done)
                    await flushPromises()
                    done.called.should.be.false()
                    finish({ count: 0, instances: [], applications: [], self: null, supportsApplications: true })
                    await sending
                    getInstancesStub.callCount.should.equal(1)
                    should(done.args[0][0]).be.undefined()
                    should(env.mqttStub.publish.args[0][0]).equal(outTopic)
                })

                it('shows an error and fails sends when the platform does not support application scope', async function () {
                    const env = setup()
                    asApplicationDevice(env)
                    const getInstancesStub = stubInstances({ supportsApplications: false })
                    const { node, nodeEvents } = createNode(env, 'project link out', outConfig)
                    await flushPromises()
                    node.status.calledWithMatch({ fill: 'red', text: 'not supported' }).should.be.true()
                    node.error.calledOnce.should.be.true()
                    const done = sinon.fake()
                    await nodeEvents.input({ payload: 'test' }, sinon.fake(), done)
                    done.args[0][0].should.have.property('code', 'APPLICATION_SCOPE_NOT_SUPPORTED')
                    done.args[0][0].message.should.match(/not supported by this version of FlowFuse/)
                    getInstancesStub.callCount.should.equal(1)
                    env.mqttStub.publish.called.should.be.false()
                })

                it('errors without a request for messages sent while the application is unknown', async function () {
                    const env = setup()
                    asApplicationDevice(env)
                    const getInstancesStub = stubInstances()
                    getInstancesStub.rejects(new Error('connect ECONNREFUSED'))
                    const { nodeEvents } = createNode(env, 'project link out', outConfig)
                    await flushPromises()
                    getInstancesStub.callCount.should.equal(1)
                    for (let i = 0; i < 5; i++) {
                        const done = sinon.fake()
                        await nodeEvents.input({ payload: 'test' }, sinon.fake(), done)
                        done.calledOnce.should.be.true()
                        done.args[0][0].message.should.match(/application is not known yet/)
                    }
                    getInstancesStub.callCount.should.equal(1)
                    env.mqttStub.publish.called.should.be.false()
                })

                it('stops retrying when closed', async function () {
                    const env = setup()
                    asApplicationDevice(env)
                    const getInstancesStub = stubUnreachable(1)
                    const { nodeEvents } = createNode(env, 'project link out', outConfig)
                    await flushPromises()
                    nodeEvents.close(sinon.fake())
                    await clock.tickAsync(10 * 60 * 1000)
                    await flushPromises()
                    getInstancesStub.callCount.should.equal(1)
                })

                it('does not look up the application for team broadcasts', async function () {
                    const env = setup()
                    const getInstancesStub = stubInstances()
                    const { nodeEvents } = createNode(env, 'project link out', { topic, mode: 'link', broadcast: true })
                    await flushPromises()
                    await nodeEvents.input({ payload: 'test' }, sinon.fake(), sinon.fake())
                    getInstancesStub.called.should.be.false()
                })
            })

            const checkedNodes = [
                { type: 'project link in', kind: 'source', status: 'invalid source', config: { topic, broadcast: true, project: 'other-instance' } },
                { type: 'project link out', kind: 'target', status: 'invalid target', config: { topic, mode: 'link', broadcast: false, project: 'other-instance' } },
                { type: 'project link call', kind: 'target', status: 'invalid target', config: { topic, project: 'other-instance' } }
            ]
            const otherInstance = { id: 'other-instance', name: 'Other', type: 'instance', applicationId: APPLICATION_ID }

            for (const { type, kind, status, config } of checkedNodes) {
                describe(type, function () {
                    it(`keeps the connection status and warns with the error code while the ${kind} cannot be checked`, async function () {
                        const env = setup()
                        const getInstancesStub = stubInstances({ instances: [otherInstance] })
                        getInstancesStub.onCall(0).rejects(Object.assign(new Error(''), { code: 'ECONNREFUSED' }))
                        const { node } = createNode(env, type, config)
                        await flushPromises()
                        node.status.calledWithMatch({ text: status }).should.be.false()
                        node.warn.calledOnce.should.be.true()
                        node.warn.args[0][0].should.equal(`Unable to check ${kind} 'other-instance' with FlowFuse, will keep retrying: ECONNREFUSED`)

                        const onConnect = env.mqttStub.on.args.find(args => args[0] === 'connect')[1]
                        onConnect({ properties: {} })
                        await flushPromises()
                        node.status.calledWithMatch({ fill: 'green', text: 'connected' }).should.be.true()
                        node.status.calledWithMatch({ text: status }).should.be.false()
                        node.warn.calledOnce.should.be.true()
                    })

                    it(`shows "${status}" when a retry finds the ${kind} is not in FlowFuse`, async function () {
                        const env = setup()
                        const getInstancesStub = stubInstances({ instances: [] })
                        getInstancesStub.onCall(0).rejects(new Error('connect ECONNREFUSED'))
                        const { node } = createNode(env, type, config)
                        await flushPromises()
                        node.status.calledWithMatch({ text: status }).should.be.false()

                        await clock.tickAsync(35 * 1000)
                        await flushPromises()
                        getInstancesStub.callCount.should.equal(2)
                        node.status.calledWithMatch({ fill: 'red', text: status }).should.be.true()
                        node.warn.args[1][0].should.match(new RegExp(`Selected ${kind} 'other-instance' not found in FlowFuse`))
                    })

                    it(`stops checking the ${kind} when closed`, async function () {
                        const env = setup()
                        const getInstancesStub = stubInstances({ instances: [] })
                        getInstancesStub.rejects(new Error('connect ECONNREFUSED'))
                        const { node, nodeEvents } = createNode(env, type, config)
                        await flushPromises()
                        nodeEvents.close(sinon.fake())

                        await clock.tickAsync(10 * 60 * 1000)
                        await flushPromises()
                        getInstancesStub.callCount.should.equal(1)
                        node.status.calledWithMatch({ text: status }).should.be.false()
                    })
                })
            }
        })
    })
})
