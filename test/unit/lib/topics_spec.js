const should = require('should') // eslint-disable-line no-unused-vars
const { isValidSubscriptionTopic, isValidPublishTopic } = require('../../../lib/topics.js')

describe('topics', function () {
    const TEAM = 'ABCD5678'
    const APP = 'aBcD3fGh1'

    describe('isValidSubscriptionTopic', function () {
        const valid = [
            `ff/v1/${TEAM}/p/instance-1/in/a/b`,
            `ff/v1/${TEAM}/p/dev:device-1/in/a`,
            `ff/v1/${TEAM}/p/+/out/a/b`,
            `ff/v1/${TEAM}/p/instance-1/res-abc123/a`,
            `$share/instance-1/ff/v1/${TEAM}/p/instance-1/in/a`,
            `ff/v1/${TEAM}/a/${APP}/p/+/out/a/b`,
            `ff/v1/${TEAM}/a/${APP}/p/dev:device-1/out/a`,
            `$share/instance-1/ff/v1/${TEAM}/a/${APP}/p/+/out/a`
        ]
        const invalid = [
            `ff/v1/${TEAM}/pa/${APP}/+/out/a`, // the old application topic shape
            `ff/v1/${TEAM}/a/${APP}/+/out/a`, // application topic without the `p` type
            `ff/v1/${TEAM}/a/+/p/+/out/a`, // wildcard application
            `ff/v1/${TEAM}/d/device-1/in/a`, // unknown type
            `ff/v1/${TEAM}/p/+/out`, // no sub topic
            `ff/v1/${TEAM}/p/+/out/a/#`, // multi-level wildcard
            `ff/v1/${TEAM}/p/+/out/a b`, // space
            `ff/v1/${TEAM}/p/+/out//a`, // empty level
            `/ff/v1/${TEAM}/p/+/out/a` // leading slash
        ]
        valid.forEach(topic => {
            it(`accepts ${topic}`, function () {
                isValidSubscriptionTopic(topic).should.be.true()
            })
        })
        invalid.forEach(topic => {
            it(`rejects ${topic}`, function () {
                isValidSubscriptionTopic(topic).should.be.false()
            })
        })
    })

    describe('isValidPublishTopic', function () {
        const valid = [
            `ff/v1/${TEAM}/p/instance-1/in/a/b`,
            `ff/v1/${TEAM}/p/dev:device-1/in/a`,
            `ff/v1/${TEAM}/p/instance-1/out/a`,
            `ff/v1/${TEAM}/p/instance-1/res-abc123/a`,
            `ff/v1/${TEAM}/a/${APP}/p/instance-1/out/a/b`,
            `ff/v1/${TEAM}/a/${APP}/p/dev:device-1/out/a`
        ]
        const invalid = [
            `ff/v1/${TEAM}/pa/${APP}/instance-1/out/a`, // the old application topic shape
            `ff/v1/${TEAM}/a/${APP}/instance-1/out/a`, // application topic without the `p` type
            `ff/v1/${TEAM}/p/+/out/a`, // wildcard source
            `ff/v1/${TEAM}/a/${APP}/p/+/out/a`, // wildcard source
            `ff/v1/${TEAM}/p//in/a`, // empty target (e.g. a direct send with no target)
            `ff/v1/${TEAM}/p/instance-1/in`, // no sub topic
            `$share/instance-1/ff/v1/${TEAM}/p/instance-1/in/a` // shared subscriptions are not for publishing
        ]
        valid.forEach(topic => {
            it(`accepts ${topic}`, function () {
                isValidPublishTopic(topic).should.be.true()
            })
        })
        invalid.forEach(topic => {
            it(`rejects ${topic}`, function () {
                isValidPublishTopic(topic).should.be.false()
            })
        })
    })
})
