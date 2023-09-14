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
