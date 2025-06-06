const should = require('should') // eslint-disable-line no-unused-vars
const mocha = require('mocha') // eslint-disable-line no-unused-vars
const sinon = require('sinon')
const utils = require('../../../lib/utils.js')
const MQTT = require('mqtt')
const projects = require('../../../lib/projects')
const projectLinkPackage = require('../../../nodes/project-link.js')
const { HttpProxyAgent } = require('http-proxy-agent')
const { HttpsProxyAgent } = require('https-proxy-agent')

const TEAM_ID = 'ABCD5678'
const PROJECT_ID = '1234-5678-9012-9876abcdef12'
describe('project-link node', function () {
    afterEach(function () {
        delete process.env.http_proxy
        delete process.env.https_proxy
        sinon.restore()
    })

    function setup (httpProxy, httpsProxy, allProxy, noProxy, forgeUrl, mqttUrl) {
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
                            clientId: 'nr-project-link'
                        }
                    }
                }
            },
            log: {
                error: sinon.fake(() => { console.error(...arguments) }),
                debug: sinon.fake(() => { console.debug(...arguments) }),
                log: sinon.fake(() => { console.log(...arguments) }),
                warn: sinon.fake(() => { console.warn(...arguments) }),
                info: sinon.fake(() => { console.info(...arguments) }),
                trace: sinon.fake(() => { console.trace(...arguments) })
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
                const env = setup('http://proxy:3128', null, null, 'testfuse.com', 'https://testfuse.com', 'wss://testfuse.com')
                const RED = env.RED
                const spy = sinon.spy(utils, 'getHTTPProxyAgent')
                projectLinkPackage(RED)
                spy.calledOnce.should.be.true()
                spy.returned({}).should.be.true()
            })
            it('should not add proxy to GOT instance for http request if http_proxy is unset', function () {
                const env = setup(null, 'http://localhost:3128', null, '127.0.0.1,google.com', 'http://testfuse.com', 'ws://testfuse.com')
                const RED = env.RED
                const spy = sinon.spy(utils, 'getHTTPProxyAgent')
                projectLinkPackage(RED)
                spy.calledOnce.should.be.true()
                spy.returned({}).should.be.true()
            })
            it('should not add proxy to GOT instance for https request if https_proxy is unset', function () {
                const env = setup('http://localhost:3128', null, null, '127.0.0.1,google.com', 'https://testfuse.com', 'wss://testfuse.com')
                const RED = env.RED
                const spy = sinon.spy(utils, 'getHTTPProxyAgent')
                projectLinkPackage(RED)
                spy.calledOnce.should.be.true()
                spy.returned({}).should.be.true()
            })
            it('should add http proxy to GOT instance if env vars are set', function () {
                const env = setup('http://localhost:3128', null, null, null, 'http://testfuse.com', 'ws://testfuse.com')
                const RED = env.RED
                const spy = sinon.spy(utils, 'getHTTPProxyAgent')
                projectLinkPackage(RED)
                spy.calledOnce.should.be.true()
                const getHTTPProxyAgentReturnValue = spy.returnValues[0]
                getHTTPProxyAgentReturnValue.should.have.property('http').and.be.an.instanceOf(HttpProxyAgent)
                getHTTPProxyAgentReturnValue.should.not.have.property('https')
            })
            it('should add https proxy to GOT instance if env vars are set', function () {
                const env = setup(null, 'http://localhost:3128', null, null, 'https://testfuse.com', 'wss://testfuse.com')
                const RED = env.RED
                const spy = sinon.spy(utils, 'getHTTPProxyAgent')
                projectLinkPackage(RED)
                spy.calledOnce.should.be.true()
                const getHTTPProxyAgentReturnValue = spy.returnValues[0]
                getHTTPProxyAgentReturnValue.should.have.property('https').and.be.an.instanceOf(HttpsProxyAgent)
                getHTTPProxyAgentReturnValue.should.not.have.property('http')
            })
            it('should add http proxy to GOT instance if all_proxy is set', function () {
                const env = setup(null, null, 'http://localhost:3128', null, 'http://testfuse.com', 'ws://testfuse.com')
                const RED = env.RED
                const spy = sinon.spy(utils, 'getHTTPProxyAgent')
                projectLinkPackage(RED)
                spy.calledOnce.should.be.true()
                const getHTTPProxyAgentReturnValue = spy.returnValues[0]
                getHTTPProxyAgentReturnValue.should.have.property('http').and.be.an.instanceOf(HttpProxyAgent)
                getHTTPProxyAgentReturnValue.should.not.have.property('https')
            })
            it('should add https proxy to GOT instance if all_proxy is set', function () {
                const env = setup(null, null, 'http://localhost:3128', null, 'https://testfuse.com', 'wss://testfuse.com')
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
                NodeConstructor.call(baseNode, { topic: 'ff/v1/0A1B2C3D4F/p/00001111-1234-5678-9012-9876abcdef12/out/test/test' })
                spy.calledOnce.should.be.false()
            })
            it('should not add proxy to MQTT if no_proxy includes target domain', function () {
                const env = setup('http://localhost:3128', null, null, '127.0.0.1,testfuse.com,other-domain,.parent-domain.io', 'https://testfuse.com', 'ws://testfuse.com')
                const RED = env.RED
                const spy = sinon.spy(utils, 'getWSProxyAgent')
                projectLinkPackage(RED)
                const NodeConstructor = env.nodes['project link in'].NodeConstructor
                // creating any of the nodes will cause MQTT to attempt connection and thus call getWSProxyAgent (if it's going to be called)
                NodeConstructor.call(baseNode, { topic: 'ff/v1/0A1B2C3D4F/p/00001111-1234-5678-9012-9876abcdef12/out/test/test' })

                spy.calledOnce.should.be.true()
                env.mqttConnectStub.calledOnce.should.be.true()
                const mqttConnectOptions = env.mqttConnectStub.args[0][1]
                should(mqttConnectOptions.wsOptions?.agent).be.null()
            })
            it('should add http proxy to MQTT if env vars are set', function () {
                const env = setup('http://localhost:3128')
                const RED = env.RED
                const spy = sinon.spy(utils, 'getWSProxyAgent')
                projectLinkPackage(RED)
                const NodeConstructor = env.nodes['project link in'].NodeConstructor
                // creating any of the nodes will cause MQTT to attempt connection and thus call getWSProxyAgent (if it's going to be called)
                NodeConstructor.call(baseNode, { topic: 'ff/v1/0A1B2C3D4F/p/00001111-1234-5678-9012-9876abcdef12/out/test/test' })
                spy.calledOnce.should.be.true()
                const getWSProxyAgentReturnValue = spy.returnValues[0]
                getWSProxyAgentReturnValue.should.be.an.instanceOf(HttpProxyAgent)

                env.mqttConnectStub.calledOnce.should.be.true()
                const mqttConnectOptions = env.mqttConnectStub.args[0][1]
                mqttConnectOptions.should.have.property('wsOptions').and.be.an.Object()
                mqttConnectOptions.wsOptions.should.have.property('agent').and.be.an.instanceOf(HttpProxyAgent)
            })
            it('should add https proxy to MQTT if env vars are set', function () {
                const env = setup(null, 'http://localhost:3128', null, null, null, 'wss://localhost:1883')
                const RED = env.RED
                const spy = sinon.spy(utils, 'getWSProxyAgent')
                projectLinkPackage(RED)
                const NodeConstructor = env.nodes['project link in'].NodeConstructor
                // creating any of the nodes will cause MQTT to attempt connection and thus call getWSProxyAgent (if it's going to be called)
                NodeConstructor.call(baseNode, { topic: 'ff/v1/0A1B2C3D4F/p/00001111-1234-5678-9012-9876abcdef12/out/test/test' })
                spy.calledOnce.should.be.true()
                const getWSProxyAgentReturnValue = spy.returnValues[0]
                getWSProxyAgentReturnValue.should.be.an.instanceOf(HttpsProxyAgent)

                env.mqttConnectStub.calledOnce.should.be.true()
                const mqttConnectOptions = env.mqttConnectStub.args[0][1]
                mqttConnectOptions.should.have.property('wsOptions').and.be.an.Object()
                mqttConnectOptions.wsOptions.should.have.property('agent').and.be.an.instanceOf(HttpsProxyAgent)
            })
            it('should add http proxy to MQTT if all_proxy is set', function () {
                const env = setup(null, null, 'http://localhost:3128')
                const RED = env.RED
                const spy = sinon.spy(utils, 'getWSProxyAgent')
                projectLinkPackage(RED)
                const NodeConstructor = env.nodes['project link in'].NodeConstructor
                // creating any of the nodes will cause MQTT to attempt connection and thus call getWSProxyAgent (if it's going to be called)
                NodeConstructor.call(baseNode, { topic: 'ff/v1/0A1B2C3D4F/p/00001111-1234-5678-9012-9876abcdef12/out/test/test' })
                spy.calledOnce.should.be.true()
                const getWSProxyAgentReturnValue = spy.returnValues[0]
                getWSProxyAgentReturnValue.should.be.an.instanceOf(HttpProxyAgent)

                env.mqttConnectStub.calledOnce.should.be.true()
                const mqttConnectOptions = env.mqttConnectStub.args[0][1]
                mqttConnectOptions.should.have.property('wsOptions').and.be.an.Object()
                mqttConnectOptions.wsOptions.should.have.property('agent').and.be.an.instanceOf(HttpProxyAgent)
            })
            it('should add https proxy to MQTT if all_proxy is set', function () {
                const env = setup(null, null, 'http://localhost:3128', null, null, 'wss://localhost:1883')
                const RED = env.RED
                const spy = sinon.spy(utils, 'getWSProxyAgent')
                projectLinkPackage(RED)
                const NodeConstructor = env.nodes['project link in'].NodeConstructor
                // creating any of the nodes will cause MQTT to attempt connection and thus call getWSProxyAgent (if it's going to be called)
                NodeConstructor.call(baseNode, { topic: 'ff/v1/0A1B2C3D4F/p/00001111-1234-5678-9012-9876abcdef12/out/test/test' })
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
            NodeConstructor.call(inNode, { topic, project: PROJECT_ID })

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
            projects.projects = sinon.stub().returns({
                getProjects: sinon.stub().resolves({ count: 1, projects: [{ id: PROJECT_ID, name: 'A-PROJECT' }] }),
                projects: [{ id: '1', name: 'A' }]
            })
            const topic = 'cloud/project-nodes-test/call'
            const expectedPubTopic = `ff/v1/${TEAM_ID}/p/${PROJECT_ID}/in/${topic}`
            const expectedSubTopic = `ff/v1/${TEAM_ID}/p/${PROJECT_ID}/res/${topic}`
            projectLinkPackage(RED)
            const NodeConstructor = env.nodes['project link call'].NodeConstructor
            NodeConstructor.call(callNode, { topic, project: PROJECT_ID })
            callNode.should.have.property('topic', expectedPubTopic)
            callNode.should.have.property('responseTopic', expectedSubTopic)
            env.mqttStub.subscribe.calledOnce.should.be.true()
            should(env.mqttStub.subscribe.args[0][0]).equal(expectedSubTopic)
            const options = env.mqttStub.subscribe.args[0][1]
            should(options).be.an.Object()
            options.should.have.property('qos').and.equal(2)

            // send a message to the node so that it can publish
            await nodeEvents.input({ payload: 'test' }, sinon.fake(), sinon.fake())

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
            NodeConstructor.call(outNode, { topic, project: PROJECT_ID })
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
    })
})
