module.exports = {
    isValidSubscriptionTopic,
    isValidPublishTopic
}

/**
 * Opinionated test to check topic is valid for subscription...
 * * May start with $share/<group>/
 * * Must not contain  `<space>` `+` `#` `$` `\` `\b` `\f` `\n` `\r` `\t` `\v`
 * * Type must be `p` or `a/<application>/p`
 * * Permits `+` character as the source (instance or device id)
 * * Must have at least 1 character between slashes
 * * Must not start or end with a slash
 * @param {string} topic
 * @returns `true` if it is a valid sub topic
 */
function isValidSubscriptionTopic (topic) {
    return /^(?:\$share\/[^/$+#\b\f\n\r\t\v\0\s]+\/)?(?:[^/$+#\b\f\n\r\t\v\0\s]+\/){3}(?:p\/|a\/[^/$+#\b\f\n\r\t\v\0\s]+\/p\/)(?:\+|[^/$+#\b\f\n\r\t\v\0\s]+)(?:\/(?:[^/$+#\b\f\n\r\t\v\0\s]+?)){2,}$/.test(topic)
}

/**
 * Opinionated test to check topic is valid for publishing...
 * * Must not contain  `<space>` `+` `#` `$` `\` `\b` `\f` `\n` `\r` `\t` `\v`
 * * Type must be `p` or `a/<application>/p`
 * * Must have at least 1 character between slashes
 * * Must not start or end with a slash
 * @param {string} topic
 * @returns `true` if it is a valid sub topic
 */
function isValidPublishTopic (topic) {
    return /^(?:[^/$+#\b\f\n\r\t\v\0]+\/){3}(?:p\/|a\/[^/$+#\b\f\n\r\t\v\0]+\/p\/)(?:[^/$+#\b\f\n\r\t\v\0]+)(?:\/(?:[^/$+#\b\f\n\r\t\v\0]+?)){2,}$/.test(topic)
}
