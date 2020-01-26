#!/usr/bin/env node

const path = require('path');
const randomBytes = require('randombytes');
const net = require('net');
const fs = require('fs');
const Writable = require('stream').Writable;

const _ = require('lodash');
const readlineSync = require('readline-sync');
const docopt = require('docopt').docopt;
const Peer = require('peerjs-on-node').Peer;

// PARSE COMMAND LINE ARGUMENTS -------------------------------------------------------------------

const args = docopt(`
Usage:
    p2pnc <localPort> <serverPort>
        [ -v | --verbose ]
        [ -s | --print-sdp-strings ]
    p2pnc -h | --help

Options:
    -v, --verbose
        print out extra information about events that happen
    -s, --print-sdp-strings
        print the raw SDP strings that are exchanged at the
        start of the connection
`);

// GLOBALS ----------------------------------------------------------------------------------------

// To prevent data channel duffer of 16Mb from getting filled up which causes the data channel to
// completely stop working
const MAX_DATA_CHANNEL_BUFFER_SIZE = 2 * 1024 * 1024; // 2Mb
const DATA_CHANNEL_LOW_CHECK_INTERVAL = 100; // milliseconds

// This will be initialized later once the signalling stuff is ready
let peerClient;

// FUNCTIONS --------------------------------------------------------------------------------------

function printStats(conn) {
    conn.peerConnection.getStats().then((res) => {
        const transports = _.filter(Array.from(res.values()), (element) => element.type === 'transport' );
        _.each(transports, (transport) => {
            const candidatePair = res.get(transport.selectedCandidatePairId);
            const localCandidate = res.get(candidatePair.localCandidateId);
            const remoteCandidate = res.get(candidatePair.remoteCandidateId);

            console.log(`LOCAL: ${localCandidate.protocol} ${localCandidate.ip} ${localCandidate.port}`);
            console.log(`REMOTE: ${remoteCandidate.protocol} ${remoteCandidate.ip} ${remoteCandidate.port}`);
        });
    });
}

// MAIN -------------------------------------------------------------------------------------------

let peerjsServerId = ''
try {
    // Try to get the peerjsServerId from a config file
    const config = require('./config.json');
    peerjsServerId = config.peerjsServerId;
    if (!peerjsServerId) {
        throw "config does not have required data";
    }
} catch(e) {
    // Ask the user to manually enter it instead
    console.log('peerjsServerId not found in the config.json file');
    peerjsServerId = readlineSync.question('Enter the ID for the remote server: ', { 
        hideEchoBack: true
    });
}

if (!peerjsServerId) {
    console.log('ERROR: peerjsServerId value is empty. Exiting');
    process.exit();
}

const peer = new Peer({debug: 2});
peer.on('open', () => {
    console.log('CONNECTED TO PEERJS SERVER');

    let serverPortConnected = false;

    const conn = peer.connect(peerjsServerId);

    conn.on('open', () => {
        console.log('DATA CONNECTION OPENED');
        printStats(conn);

        // THE MAIN DATA CHANNEL CALLBACKS

        conn.on('close', () => {
            console.log('DATA CONNECTION CLOSED');
        });

        conn.on('error', (err) => {
            console.log('DATA CONNECTION ERROR');
            console.log(err);
        });

        conn.on('data', (data) => {
            // We should only ever see any data in here as a response to the command that we send
            // to the server to specify which server we want to create a tunnel for. So, we can
            // safely ignore any subsequent data
            if (serverPortConnected) return

            data = '' + data;
            if (data === 'ok'){
                // The server tells us that it has connected to the port that the user requested and is
                // ready to forward the p2p data stream to it
                console.log(`Peer server listening on port ${args['<serverPort>']}`);

                // Setup a TCP server for the client user to use
                const tcpServer = new net.createServer((socket) => {
                    if (args['--verbose']) {
                        console.log(`Something connected to local port ${args['<localPort>']}`);
                    }

                    // Create a new data channel on the peer connection with a random name
                    const newDataChannelName = 'custom_' + randomBytes(20).toString('hex');
                    const dataChannel = conn.peerConnection.createDataChannel(newDataChannelName);
                    dataChannel.binaryType = 'arraybuffer';
                    dataChannel.onmessage = (event) => {
                        const data = Buffer.from(event.data);
                        socket.write(data);
                    }
                    dataChannel.onclose = () => {
                        if (args['--verbose']) {
                            console.log('data channel closed');
                        }
                    }
                    dataChannel.onerror = (err) => {
                        console.log('data channel error: ' + err);
                    }

                    // Setup the socket to the use the data from the p2p data channel
                    socket.setKeepAlive(true);
                    socket.on('data', (data) => {
                        // Protect the data channel buffer from getting filled up
                        if (dataChannel.bufferedAmount < MAX_DATA_CHANNEL_BUFFER_SIZE){
                            try {
                                dataChannel.send(data);
                            } catch(e) {
                                console.log(e);
                                tcpClient.end();
                            }
                        } else {
                            tcpClient.pause();

                            // Check the bufferedAmount until it goes acceptably low
                            const bufferCheckInterval = setInterval(() => {
                                if (dataChannel.bufferedAmount === 0){
                                    try {
                                        dataChannel.send(data);
                                    } catch(e) {
                                        console.log(e);
                                        tcpClient.end();
                                    }
                                    clearInterval(bufferCheckInterval);
                                    tcpClient.resume();
                                }
                            }, DATA_CHANNEL_LOW_CHECK_INTERVAL);
                        }

                    });
                    socket.on('end', () => {
                        if (args['--verbose'])
                            console.log(`TCP socket connection ended`)
                        dataChannel.close();
                    });
                    socket.on('close', () => {
                        if (args['--verbose'])
                            console.log('TCP socket connection closed');
                        dataChannel.close();
                    });
                    socket.on('error', (err) => {
                        console.log('TCP socket error: ' + err)
                    });
                })
                tcpServer.listen(args['<localPort>'], () => {
                    serverPortConnected = true;
                    console.log(`Peer client listening on port ${args['<localPort>']}`);
                });

                tcpServer.on('error', (err) => {
                    console.log('TCP Error: ' + err)
                    peer.destroy();
                });               
            } else {
                // peer server was not able to setup a TCP port connection to the desired port
                console.log(data);
                peer.destroy();
            }
        });

        // Tell the server about which port we want to use on the server
        conn.send(`p:${args['<serverPort>']}`);
    });
});

peer.on('disconnected', () => {
    console.log('PEER DISCONNECTED. Trying to reconnect to peerjs server');
    peer.reconnect();
});

peer.on('error', (err) => {
    console.log('PEER ERROR');
    console.log(err);
});

peer.on('close', () => {
    console.log('PEER CLOSED');
    process.exit();
});

process.on('SIGINT', () => {
    console.log('Ctrl+c: EXITING ----------------');
    peer.destroy();
    process.exit();
});

