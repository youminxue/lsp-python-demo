#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const parseArgs = require("minimist");
const yaml = require("js-yaml");
const ws = require("ws");
const rpcServer = require("@sourcegraph/vscode-ws-jsonrpc/lib/server");
let argv = parseArgs(process.argv.slice(2));
if (argv.help || !argv.languageServers) {
    console.log(`Usage: server.js --port 3000 --languageServers config.yml`);
    process.exit(1);
}
let serverPort = parseInt(argv.port) || 3000;
let languageServers;
try {
    let parsed = yaml.safeLoad(fs.readFileSync(argv.languageServers), 'utf8');
    if (!parsed.langservers) {
        console.log('Your langservers file is not a valid format, see README.md');
        process.exit(1);
    }
    languageServers = parsed.langservers;
}
catch (e) {
    console.error(e);
    process.exit(1);
}
const wss = new ws.Server({
    port: serverPort,
    perMessageDeflate: false
}, () => {
    console.log(`Listening to http and ws requests on ${serverPort}`);
});
function toSocket(webSocket) {
    return {
        send: content => webSocket.send(content),
        onMessage: cb => webSocket.onmessage = event => cb(event.data),
        onError: cb => webSocket.onerror = event => {
            if ('message' in event) {
                cb(event.message);
            }
        },
        onClose: cb => webSocket.onclose = event => cb(event.code, event.reason),
        dispose: () => webSocket.close()
    };
}
wss.on('connection', (client, request) => {
    let langServer;
    Object.keys(languageServers).forEach((key) => {
        if (request.url === '/' + key) {
            langServer = languageServers[key];
        }
    });
    if (!langServer || !langServer.length) {
        console.error('Invalid language server', request.url);
        client.close();
        return;
    }
    let localConnection = rpcServer.createServerProcess('Example', langServer[0], langServer.slice(1));
    let socket = toSocket(client);
    let connection = rpcServer.createWebSocketConnection(socket);
    rpcServer.forward(connection, localConnection);
    console.log(`Forwarding new client`);
    socket.onClose((code, reason) => {
        console.log('Client closed', reason);
        localConnection.dispose();
    });
});
