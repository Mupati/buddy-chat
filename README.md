# Buddy Chat
A basic native WebRTC peer to peer Web App implementation

It includes a web client and a signaling server for clients to connect and do signaling for WebRTC.

It uses [adapter.js](https://github.com/webrtc/adapter) for WebRTC and [socket.io](https://socket.io/) for signaling

### Dependencies

* [NodeJS](https://nodejs.org)
* [Docker](https://www.docker.com)

### Starting with Docker

Go to the directory that has your Dockerfile and run the following command to build the Docker image. The -t flag lets you tag your image so it's easier to find later using the docker images command:

```
docker build . -t <your username>/webrtc-app
```

Run the image you previously built:

```
docker run -p 8080:80 -e DEBUG=* -d <your username>/webrtc-app
```

Using this command the app will be accessible at [localhost:8080](http://localhost:8080) and running in [DEBUG mode](https://www.npmjs.com/package/debug)

### Starting and debugging (without docker)

Build the backend:

```npm run build```

Autofix code style:

```npm run lint:fix```

For just running:

```npm run dev```

For running with debug mode:

```DEBUG=* npm run dev```

### Credit where credit is due:

Initial code from https://github.com/googlecodelabs/webrtc-web