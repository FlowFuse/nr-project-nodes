# FlowForge Project Nodes

A collection of Node-RED nodes for easy communication between projects running
in the FlowForge platform.

These nodes act in a similar way to the core Node-RED Link nodes - but can be
used to send and receive messages between different Node-RED projects.

Whilst these nodes are published under the Apache-2.0 license, they can only be
used with an instance of the FlowForge platform with an active EE license applied.

### Nodes

There are three nodes in this collection:

 - `Project In` - listens for messages being broadcast by other projects, or for
   messages being sent just to this project
 - `Project Out` - sends messages to other projects
 - `Project Call` - sends messages to other projects and waits for a response

The nodes send the whole `msg` object between projects. Due to the way the nodes
encode messages, there are some data types that do not get sent. For example,
the `msg.req`/`msg.res` properties used by the core HTTP nodes will not be sent.

### Configuration

To enable the nodes in the palette, they require a number of properties to be provided
in the runtime's `settings.js` file.

```
    flowForge: {
        forgeURL: 'http://xxxxxxxxx:3000',
        teamID:  'xxxxxxxx',
        projectID: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
        projectLink: {
            token: 'fft_xxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
            broker: {
                url: '',
                username: 'xxxx',
                password: 'xxxx',
            }
        }
    }
```

