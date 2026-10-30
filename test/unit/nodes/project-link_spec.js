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
const PROJECT_ID = '1234-5678-9012-9876abcdef12'
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
        const mqttConnectStub = sinon.stub(MQTT, 'connect').returns(mqttStub)
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
                const mqttConnectOptions = env.mqttConnectStub.args[0][1]
                should(mqttConnectOptions.wsOptions?.agent).be.null()
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
                const mqttConnectOptions = env.mqttConnectStub.args[0][1]
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
                const mqttConnectOptions = env.mqttConnectStub.args[0][1]
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
                const mqttConnectOptions = env.mqttConnectStub.args[0][1]
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
                const mqttConnectOptions = env.mqttConnectStub.args[0][1]
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
            const mqttConnectOptions = env.mqttConnectStub.args[0][1]
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
            const mqttConnectOptions = env.mqttConnectStub.args[0][1]
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
            await nodeEvents.input({ payload: 'test' }, sinon.fake(), sinon.fake())
            should(env.mqttStub.publish.args[0][0]).equal(`ff/v1/${TEAM_ID}/a/${APPLICATION_ID}/p/dev:${DEVICE_ID}/out/${topic}`)
        })

        it('project link out treats broadcast "application" as application scope even without a scope', async function () {
            const env = setup()
            asApplicationDevice(env)
            stubInstances()
            const topic = 'app/topic'
            const { nodeEvents } = createNode(env, 'project link out', { topic, mode: 'link', broadcast: 'application' })
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
