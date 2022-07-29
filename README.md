# flowforge-nr-project-nodes

Node-RED project link nodes for the FlowForge platform.

This package provides a set of nodes to provide project to project
intercommunication on the FlowForge platform.

### About

The basic premise of the project link nodes are similar to that of the core Node-RED link nodes whereby there are 3 nodes that provide invisible linkage between nodes. However, the project link nodes operate across multiple Node-RED projects

#### Nodes...
* project link in
* project link out
* project link call

The whole `msg` object is transmitted from project to project meaning that properties like `msg.topic` and `msg.my_custom_property` will be included in the transmission

#### project link in
This node listens for `msg`s sent by either `project link call` or `project link out`

#### project link out
This node sends `msg`s to the target project/path and will be received by a matching `project link in` node

#### project link call
This node sends `msg`s to the target `project link in` project/. 
The `msg` MUST be returned by a `project link out` set to mode "return"
The returned `msg` will then be sent out of the `project link call` output

### Known issues
* Only the below data types are supported. Other data types will either be converted to an `object` or `string` or will cause an error
  * `boolean`
  * `string`
  * `integer`
  * `BigInt`
  * `array`
  * `object`
  * `Buffer`
  * `Set`
  * `Map`
* Properties in the `msg` with a value of `undefined` will be converted to `null`.
This is a current short coming of the internal data serialisation and de-serialisation methods

### Configuration

The settings file must contain a flowForge setting and other properties in order for the node to loaded into the runtime.
If these are missing, the node will NOT be loaded.

```
    flowForge: {
        forgeURL: 'http://xxxxxxxxx:3000',
        storageURL: 'http://xxxxxxxxx:3000/storage',
        teamID:  'xxxxxxxx',
        projectID: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
        deviceID: '',
        projectLink: {
            token: 'fft_xxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
            broker: {
                url: '',
                username: 'xxxx',
                password: 'xxxx',
                clientID: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:n'
            }
        }
    }
```

### TODO

* Built in help
* Tests
* Better readme
* Support more data types in the transmission

### Future possibilities

* Allow wildcard paths
  * e.g. link out to multiple `devices/#`
* Allow link call to broadcast
* Autocomplete `path`s by publishing subscribed `path`s to retained `$` 
  * This may lead to a tree view of projects and paths instead of separate form elements
* Show link dotted wire and a deep linking shortcut to the target project/node

