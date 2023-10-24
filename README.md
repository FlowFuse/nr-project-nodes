# FlowFuse Project Nodes

A collection of Node-RED nodes for easy communication between Node-RED instances
running in the [FlowFuse platform](https://flowfuse.com).

These nodes act in a similar way to the core Node-RED Link nodes - but can be
used to send and receive messages between different Node-RED instances.

Whilst these nodes are published under the Apache-2.0 license, they can only be
used with an instance of the FlowFuse platform with an active EE license applied.
If you try to install these nodes in an Non FlowFuse EE platform you will see the following error in your Node-RED log:
`Error: Project Link nodes cannot be loaded outside of FlowFuse EE environment`
This can be safely ignored.

### Prerequisites

 - FlowFuse 0.8+ running with an active EE license and its integrated MQTT Broker

Alternatively, you can [sign up to FlowFuse Cloud](https://flowfuse.com/product/)
now to try these nodes out.

### Nodes

There are three nodes in this collection:

 - `Project In` - listens for messages being broadcast by other Node-RED instances, or for
   messages being sent just to this instance
 - `Project Out` - sends messages to other Node-RED instances
 - `Project Call` - sends messages to other Node-RED instances and waits for a response

The nodes send the whole `msg` object. Due to the way the nodes encode messages,
there are some data types that do not get sent. For example, the `msg.req`/`msg.res`
properties used by the core HTTP nodes will not be sent.  Instead, they are temporarily
removed from the message and re-attached when the message is received back.

Each node is configured with a topic on which it either sends or receives messages
on. This is similar in concept to MQTT topics - although the nodes do not currently
support using MQTT wildcards in their topics.

The Project Out nodes can either broadcast messages on a topic to anyone listening,
or they can send messages on a topic to a specific other project.

The Project In nodes do the opposite - they can either listen for messages being
broadcast, or for messages sent directly to them.

The Project Call node can be used to send a message to another Project In node
and then wait for a response, with a built-in timeout if it doesn't arrive.
The response is sent back using a Project Out node configured to respond to the call
node.
