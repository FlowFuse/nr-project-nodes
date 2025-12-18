### 0.7.9
- Bump flowfuse/github-actions-workflows/.github/workflows/build_node_package.yml (#158)
- Bump flowfuse/github-actions-workflows/.github/workflows/publish_node_package.yml (#159)

### 0.7.8

 - Bump actions/checkout from 6.0.0 to 6.0.1 (#154)
 - Bump actions/setup-node from 6.0.0 to 6.1.0 (#153)
 - Bump actions/checkout from 5.0.0 to 6.0.0 (#152)
 - Bump flowfuse/github-actions-workflows from 0.42.0 to 0.43.0 (#150)
 - Bump JS-DevTools/npm-publish from 4.0.1 to 4.1.1 (#148)
 - Bump JS-DevTools/npm-publish from 4.0.0 to 4.0.1 (#147)
 - Bump JS-DevTools/npm-publish from 3.1.1 to 4.0.0 (#146)
 - Bump actions/setup-node from 4.4.0 to 5.0.0 (#145)
 - Bump actions/checkout from 4.2.2 to 5.0.0 (#144)
 - Bump flowfuse/github-actions-workflows from 0.40.0 to 0.42.0 (#143)
 - Ensure validator is correct for link retrun mode (#156) @hardillb
 - Bump glob from 10.4.5 to 10.5.0 (#151) @app/dependabot
 - Bump actions/setup-node from 5.0.0 to 6.0.0 (#149) @app/dependabot
 - Bump form-data and node-red (#138) @app/dependabot

### 0.7.7

 - Update the Project Nodes category to "FlowFuse" (#135) @joepavitt
 - Bump axios from 1.10.0 to 1.11.0 (#134) @app/dependabot

### 0.7.6

 - Ensure unique client id when in HA mode (#132) @knolleary

### 0.7.5

 - Improve feedback when selected instance/target is invalid (#126) @Steve-Mcl
 - Bump for V0.7.5 (#130) @Steve-Mcl
 - Bump brace-expansion from 1.1.11 to 1.1.12 (#128) @app/dependabot
 - Update mocha for dependencies (#127) @hardillb
 - Bump formidable from 3.5.1 to 3.5.4 (#125) @app/dependabot
 - chore: fix lint script (#123) @ppawlowski
 - Bump axios from 1.7.4 to 1.8.4 (#122) @app/dependabot
 - chore: Pin external actions to commit hash (#121) @ppawlowski
 - Bump serialize-javascript and mocha (#117) @app/dependabot

### 0.7.4

 - Bump flowfuse/github-actions-workflows from 0.34.0 to 0.36.0 (#111) @dependabot
 - Bump cookie, node-red and express (#110) @dependabot
 - Bump flowfuse/github-actions-workflows from 0.30.0 to 0.34.0 (#109) @dependabot
 - Bump flowfuse/github-actions-workflows from 0.29.0 to 0.30.0 (#107) @dependabot
 - Bump express and node-red (#106) @dependabot
 - Randomise reconnect period (#104) @Steve-Mcl
 - Bump flowfuse/github-actions-workflows from 0.28.0 to 0.29.0 (#105) @dependabot

### 0.7.3

 - Ensure all pub/sub MQTT operations use QoS 2 (#99) @Steve-Mcl
 - Bump flowfuse/github-actions-workflows from 0.1.0 to 0.28.0 (#97) @dependabot

### 0.7.2

 - Bump axios from 1.7.2 to 1.7.4 (#93) @dependabot

### 0.7.1

 - Bump tibdex/github-app-token from 1 to 2 (#77) @dependabot
 - Update release-publish.yml to NodeJS v18 (#88) @hardillb
 - Bump ws and node-red (#87) @dependabot
 - Bump JS-DevTools/npm-publish from 2 to 3 (#76) @dependabot

### 0.7.0

 - Proxy support (#81) @Steve-Mcl
 - Update build.yml to run tests and other node versions (#83) @Steve-Mcl
 - Bump actions/setup-node from 1 to 4 (#79) @dependabot
 - Bump actions/checkout from 1 to 4 (#75) @dependabot
 - Enable dependabot for github actions (#73) @ppawlowski

### 0.6.4

 - Add 'node-red' keyword (#71) @knolleary

### 0.6.3

 - Add a 2 minute session expiry on the mqtt connection (#69) @knolleary

### 0.6.2

 - Fix Project Nodes multiple MQTT connections issue (#66) @Steve-Mcl
 - Display "feature not available" if feature flag is false (#63) @Steve-Mcl
 - Better determination of device owner (#65) @Steve-Mcl
 - Update npm-publish action version to v2 (#61) @ppawlowski

### 0.6.1

 - Disable direct message option for application owned devices (#59) @Steve-Mcl
 
### 0.6.0

 - Add support for communicating with app assigned devices (#55) @Steve-Mcl
 - FIX: Remove node-red container rebuild dispatcher (#54) @ppawlowski

### 0.5.0

 - Pin reusable workflows to v0.1.0 (#53) @ppawlowski
 - Update npm package name (#52) @knolleary
 - Update ff references in package.json (#50) @knolleary
 - Change repo references in workflows after github org rename (#49) @ppawlowski
 - Publish nightly package to npmjs (#48) @ppawlowski

### 0.4.0

 - Fix `undefined (reading 'name')` error when `msg` is from a `http-in` node (#43) @Steve-Mcl
 - Bump word-wrap from 1.2.3 to 1.2.5 (#39) @app/dependabot
 - Pin reusable workflow to commit SHA (#46) @ppawlowski
 - Disable scheduled package build (#45) @ppawlowski
 - Add nr-launcher package build dispatcher (#41) @ppawlowski
 - Add node-red container build dispatch in the node package build pipeline (#40) @ppawlowski
 - FIX: Publish package on schedule (#38) @ppawlowski
 - FIX: Allow publish only when changes are pushed to `main` branch (#37) @ppawlowski
 - Introduce build and publish workflow (#36) @ppawlowski
 - Chore: Set root flag in eslint (#35) @Pezmc
 - Add package-lock.json (#33) @Pezmc

### 0.3.0

 - Use shared subscriptions where appropriate for HA support (#29) @knolleary

### 0.2.2

 - Fix frequent disconnections - Ensure keepalive is set (#25) @Steve-Mcl

### 0.2.1

- Update docs to reflect 'project' to 'instances' naming changes (#23) @knolleary

### 0.2.0

 - Add device ID, name and type to msg.projectLink (#20) @Steve-Mcl
 - Ensure ws URLs with ipv6 address can connect MQTT (#19) @Steve-Mcl
 - Update estlint (#16) @knolleary
