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
