const should = require('should') // eslint-disable-line no-unused-vars
const mocha = require('mocha') // eslint-disable-line no-unused-vars
const sinon = require('sinon')
const utils = require('../../../lib/utils.js')
const MQTT = require('mqtt')
const projectLinkPackage = require('../../../nodes/project-link.js')
const { HttpProxyAgent } = require('http-proxy-agent')
const { HttpsProxyAgent } = require('https-proxy-agent')

describe('project-link node', function () {
    afterEach(function () {
        delete process.env.http_proxy
        delete process.env.https_proxy
        sinon.restore()
    })

    describe('proxy', function () {
        function setup (httpProxy, httpsProxy, allProxy, noProxy, forgeUrl, mqttUrl) {
            const mqttConnectStub = sinon.stub(MQTT, 'connect').returns({
                on: sinon.fake(),
                subscribe: sinon.fake(),
                unsubscribe: sinon.fake(),
                publish: sinon.fake(),
                removeAllListeners: sinon.fake(),
                end: sinon.fake()
            })
            process.env.http_proxy = httpProxy || ''
            process.env.https_proxy = httpsProxy || ''
            process.env.all_proxy = allProxy || ''
            process.env.no_proxy = noProxy || ''
            const nodes = {}
            const RED = {
                settings: {
                    flowforge: {
                        forgeURL: forgeUrl || 'https://local.testfuse.com',
                        projectID: '1234',
                        teamID: '5678',
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
                }
            }
            return {
                RED,
                nodes,
                mqttConnectStub
            }
        }

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
})
