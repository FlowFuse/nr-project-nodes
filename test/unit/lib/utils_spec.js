const should = require('should')
const utils = require('../../../lib/utils.js')

describe('utils', () => {
    describe('getWSProxyAgent', function () {
        const HttpProxyAgent = require('http-proxy-agent').HttpProxyAgent
        const HttpsProxyAgent = require('https-proxy-agent').HttpsProxyAgent
        afterEach(function () {
            delete process.env.http_proxy
            delete process.env.https_proxy
            delete process.env.no_proxy
            delete process.env.all_proxy
        })
        it('should return null when there are no env vars set', function () {
            delete process.env.http_proxy
            delete process.env.https_proxy
            delete process.env.no_proxy
            delete process.env.all_proxy
            should(utils.getWSProxyAgent('ws://test.com')).be.null()
            should(utils.getWSProxyAgent('wss://test.com')).be.null()
        })
        it('should not proxy any requests if they are excluded by no_local', function () {
            process.env.http_proxy = 'http://proxy:3128'
            process.env.https_proxy = 'http://proxy:3128'
            process.env.all_proxy = 'http://proxy:3128'
            process.env.no_proxy = 'test.com'
            should(utils.getWSProxyAgent('ws://test.com')).be.null()
            should(utils.getWSProxyAgent('wss://test.com')).be.null()
            process.env.http_proxy = 'http://proxy:3128'
            process.env.https_proxy = 'http://proxy:3128'
            process.env.all_proxy = 'http://proxy:3128'
            process.env.no_proxy = '192.168.0.100'
            should(utils.getWSProxyAgent('ws://192.168.0.100')).be.null()
            should(utils.getWSProxyAgent('wss://192.168.0.100')).be.null()
        })
        it('should return a HttpProxyAgent when http_proxy is set and the URL is ws://', function () {
            const url = 'ws://test.com'
            process.env.http_proxy = 'http://proxy:3128'
            process.env.https_proxy = ''
            const agent = utils.getWSProxyAgent(url)
            should(agent).be.instanceOf(HttpProxyAgent)
            agent.should.have.property('proxy')
            agent.proxy.should.have.property('hostname', 'proxy')
            agent.proxy.should.have.property('port', '3128')
        })
        it('should return a HttpsProxyAgent when https_proxy is set and the URL is wss://', function () {
            const url = 'wss://test.com'
            process.env.http_proxy = ''
            process.env.https_proxy = 'http://proxy:3128'
            const agent = utils.getWSProxyAgent(url)
            should(agent).be.instanceOf(HttpsProxyAgent)
            agent.should.have.property('proxy')
            agent.proxy.should.have.property('hostname', 'proxy')
            agent.proxy.should.have.property('port', '3128')
        })
        it('should return a HttpProxyAgent when all_proxy is set and the URL is ws://', function () {
            const url = 'ws://test.com'
            process.env.http_proxy = ''
            process.env.https_proxy = ''
            process.env.all_proxy = 'https://all_proxy:7777'
            const agent = utils.getWSProxyAgent(url, { timeout: 4444 })
            agent.proxy.should.have.property('hostname', 'all_proxy')
            agent.proxy.should.have.property('port', '7777')
        })
        it('should return a HttpsProxyAgent when all_proxy is set and the URL is wss://', function () {
            const url = 'wss://test.com'
            process.env.http_proxy = ''
            process.env.https_proxy = ''
            process.env.all_proxy = 'https://all_proxy:8888'
            const agent = utils.getWSProxyAgent(url, { timeout: 4444 })
            agent.proxy.should.have.property('hostname', 'all_proxy')
            agent.proxy.should.have.property('port', '8888')
        })
        it('should set http proxy options', function () {
            const url = 'ws://test.com'
            process.env.http_proxy = 'http://proxy:8080'
            process.env.https_proxy = ''
            const agent = utils.getWSProxyAgent(url, { timeout: 3210 })
            agent.connectOpts.should.have.property('timeout', 3210)
        })
        it('should set https proxy options', function () {
            const url = 'wss://test.com'
            process.env.http_proxy = ''
            process.env.https_proxy = 'https://proxy:8080'
            const agent = utils.getWSProxyAgent(url, { timeout: 4444 })
            agent.connectOpts.should.have.property('timeout', 4444)
        })
    })
    describe('getHTTPProxyAgent', function () {
        const HttpProxyAgent = require('http-proxy-agent').HttpProxyAgent
        const HttpsProxyAgent = require('https-proxy-agent').HttpsProxyAgent

        afterEach(function () {
            delete process.env.http_proxy
            delete process.env.https_proxy
            delete process.env.no_proxy
        })

        it('should return an agent object without any http or https proxy when env vars are not set', function () {
            delete process.env.http_proxy
            delete process.env.https_proxy
            delete process.env.no_proxy
            const agent1 = utils.getHTTPProxyAgent('http://127.0.0.1')
            agent1.should.not.have.property('http')
            agent1.should.not.have.property('https')
            const agent2 = utils.getHTTPProxyAgent('http://localhost:3000')
            agent2.should.not.have.property('http')
            agent2.should.not.have.property('https')
            const agent3 = utils.getHTTPProxyAgent('http://testfuse.com')
            agent3.should.not.have.property('http')
            agent3.should.not.have.property('https')

            const agent4 = utils.getHTTPProxyAgent('https://127.0.0.1')
            agent4.should.not.have.property('http')
            agent4.should.not.have.property('https')
            const agent5 = utils.getHTTPProxyAgent('https://localhost:3000')
            agent5.should.not.have.property('http')
            agent5.should.not.have.property('https')
            const agent6 = utils.getHTTPProxyAgent('https://testfuse.com')
            agent6.should.not.have.property('http')
            agent6.should.not.have.property('https')
        })

        it('should not proxy any requests if they are excluded by no_local', function () {
            // http requests
            process.env.http_proxy = 'http://proxy:8080'
            process.env.https_proxy = 'http://proxy:8080'
            process.env.no_proxy = 'testfuse.com,googoo.com,.parent-domain.org' // direct connection to testfuse.com, googoo.com, and any subdomain of parent-domain.org, otherwise use proxy
            const agent1 = utils.getHTTPProxyAgent('http://testfuse.com:3000')
            agent1.should.not.have.property('http')
            agent1.should.not.have.property('https')
            const agent2 = utils.getHTTPProxyAgent('http://googoo.com:3000')
            agent2.should.not.have.property('http')
            agent2.should.not.have.property('https')
            const agent3 = utils.getHTTPProxyAgent('http://sub.parent-domain.org:3000')
            agent3.should.not.have.property('http')
            agent3.should.not.have.property('https')
            const agent4 = utils.getHTTPProxyAgent('http://some-external.com')
            agent4.should.have.property('http').instanceOf(HttpProxyAgent)
            agent4.http.should.have.property('proxy')
            agent4.http.proxy.should.have.property('hostname', 'proxy')
            agent4.http.proxy.should.have.property('port', '8080')
            // https requests
            const agent5 = utils.getHTTPProxyAgent('https://testfuse.com:3000')
            agent5.should.not.have.property('http')
            agent5.should.not.have.property('https')
            const agent6 = utils.getHTTPProxyAgent('https://googoo.com:3000')
            agent6.should.not.have.property('http')
            agent6.should.not.have.property('https')
            const agent7 = utils.getHTTPProxyAgent('https://sub.parent-domain.org:3000')
            agent7.should.not.have.property('http')
            agent7.should.not.have.property('https')
            const agent8 = utils.getHTTPProxyAgent('https://some-external.com')
            agent8.should.have.property('https').instanceOf(HttpsProxyAgent)
            agent8.https.should.have.property('proxy')
            agent8.https.proxy.should.have.property('hostname', 'proxy')
            agent8.https.proxy.should.have.property('port', '8080')
        })

        it('should return an agent object with http property when http_proxy is set and no_proxy is not in scope', function () {
            process.env.http_proxy = 'http://proxy:8080'
            process.env.https_proxy = ''
            process.env.no_proxy = 'random.com' // direct connection to random.com, otherwise use proxy
            const agent = utils.getHTTPProxyAgent('http://testfuse.com:3000')
            agent.should.have.property('http').instanceOf(HttpProxyAgent)
            agent.http.should.have.property('proxy')
            agent.http.proxy.should.have.property('hostname', 'proxy')
            agent.http.proxy.should.have.property('port', '8080')
        })
        it('should return an agent object with http property when http_proxy is set', function () {
            process.env.http_proxy = 'http://proxy:8080'
            process.env.https_proxy = ''
            process.env.no_proxy = 'random.com'
            const agent = utils.getHTTPProxyAgent('http://127.0.0.1')
            agent.should.have.property('http').instanceOf(HttpProxyAgent)
            agent.http.should.have.property('proxy')
            agent.http.proxy.should.have.property('hostname', 'proxy')
            agent.http.proxy.should.have.property('port', '8080')
        })
        it('should return an agent object with https property when https_proxy is set', function () {
            process.env.http_proxy = ''
            process.env.https_proxy = 'http://proxy:8080'
            const agent = utils.getHTTPProxyAgent('https://testfuse.com:3000')
            agent.should.have.property('https').instanceOf(HttpsProxyAgent)
            agent.https.should.have.property('proxy')
            agent.https.proxy.should.have.property('hostname', 'proxy')
            agent.https.proxy.should.have.property('port', '8080')
        })
        it('should use all_proxy to set http proxy options', function () {
            process.env.http_proxy = ''
            process.env.https_proxy = ''
            process.env.all_proxy = 'http://all_proxy:7777'
            const agent = utils.getHTTPProxyAgent('http://127.0.0.1:3000')
            agent.http.should.have.property('proxy')
            agent.http.proxy.should.have.property('hostname', 'all_proxy')
            agent.http.proxy.should.have.property('port', '7777')
        })
        it('should use all_proxy to set https proxy options', function () {
            process.env.http_proxy = ''
            process.env.https_proxy = ''
            process.env.all_proxy = 'http://all_proxy:8888'
            const agent = utils.getHTTPProxyAgent('https://127.0.0.1:3000')
            agent.https.should.have.property('proxy')
            agent.https.proxy.should.have.property('hostname', 'all_proxy')
            agent.https.proxy.should.have.property('port', '8888')
        })
        it('should set http proxy options', function () {
            process.env.http_proxy = 'http://proxy:8080'
            process.env.https_proxy = 'http://proxy:8081'
            const agent = utils.getHTTPProxyAgent('http://127.0.0.1:3000', { timeout: 2345 })
            agent.http.connectOpts.should.have.property('timeout', 2345)
        })
        it('should set https proxy options', function () {
            process.env.http_proxy = 'http://proxy:8080'
            process.env.https_proxy = 'http://proxy:8081'
            const agent = utils.getHTTPProxyAgent('https://127.0.0.1:3000', { timeout: 2345 })
            agent.https.connectOpts.should.have.property('timeout', 2345)
        })
    })

    describe('getRetryDelay', function () {
        const min = 30 * 1000
        const max = 5 * 60 * 1000
        const lowest = () => 0
        const highest = () => 0.999999

        it('starts at the minimum +/- 5 seconds', function () {
            utils.getRetryDelay(0, min, max, lowest).should.equal(25 * 1000)
            utils.getRetryDelay(0, min, max, highest).should.be.approximately(35 * 1000, 1)
        })

        it('doubles on each attempt with +/- 10% jitter', function () {
            utils.getRetryDelay(1, min, max, lowest).should.equal(54 * 1000)
            utils.getRetryDelay(2, min, max, highest).should.be.approximately(132 * 1000, 1)
        })

        it('backs off to the maximum +/- 10%', function () {
            utils.getRetryDelay(4, min, max, lowest).should.equal(270 * 1000)
            utils.getRetryDelay(20, min, max, highest).should.be.approximately(330 * 1000, 1)
        })

        it('stays within bounds with random jitter', function () {
            for (let attempt = 0; attempt < 10; attempt++) {
                const delay = utils.getRetryDelay(attempt, min, max)
                delay.should.be.within(25 * 1000, 330 * 1000)
            }
        })
    })
})
