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

function printSDP(sdp) {
    const jsonObj = JSON.parse(String(sdp));
    //const stringToPrint = `SDP ${jsonObj.type}: \n${jsonObj.sdp}`
    console.log(`SDP ${jsonObj.type}: \n    ${jsonObj.sdp.replace(/\n/g, '\n    ')}`);
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
            console.log(data);
        });

        conn.send('Hello I am the client');

        // OTHER DATA CHANNELS CREATED ON DEMAND BY CLIENT

        // TODO
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
});

process.on('SIGINT', () => {
    console.log('Ctrl+c: EXITING ----------------');
    peer.destroy();
    process.exit();
});



/*
// P2P STUFF --------------------------------------------------------------------------------------

function setupP2PStuff(){
    const peer = new Peer({
        initiator: true,
        wrtc: wrtc,
        trickle: false
    });
    let serverPortConnected = false;

    peer.on('error', (err) => {
        console.log('Peer error: ' + err);
    });

    peer.on('close', () => {
        console.log('Connection closed');
        process.exit();
    });

    peer.on('signal', (signalData) => {
        if (args['--verbose'])
            console.log('Signal generated');

        const signalStr = JSON.stringify(signalData);

        if (args['--manual-messaging']){
            console.log('Copy the following SDP string and paste it in the server');
            console.log(signalString);
        } else {
            if (args['--print-sdp-strings'])
                printSDP(signalStr)

            // Initiate the message
            messenger.sendMessage(signalStr, (res) => {
                if (args['--verbose'])
                    console.log('Signal string sent to server')}
            );
        }
    });

    peer.on('connect', () => {
        if (args['--verbose'])
            console.log('Peer connected');

        // Tell the server to connect to a TCP port on the server's local machine
        peer.send(`p:${args['<serverPort>']}`);
    });

    peer.on('data', (chunk) => {
        if (serverPortConnected) return

        chunk = '' + chunk;
        if (chunk === 'ok'){
            // The server tells us that it has connected to the port that the user requested and is
            // ready to forward the p2p data stream to it
            console.log(`Peer server listening on port ${args['<serverPort>']}`);

            const tcpServer = new net.createServer((socket) => {
                if (args['--verbose'])
                    console.log(`Something connected to local port ${args['<localPort>']}`);

                // Create a new data channel on the peer with a random name
                const dataChannel = peer._pc.createDataChannel('custom_' + randomBytes(20).toString('hex'))
                dataChannel.binaryType = 'arraybuffer';
                dataChannel.onmessage = (event) => {
                    const chunk = Buffer.from(event.data);
                    socket.write(chunk);
                }
                dataChannel.onclose = () => {
                    if (args['--verbose'])
                        console.log('data channel closed');
                }
                dataChannel.onerror = (err) => {
                    console.log('data channel error: ' + err);
                }

                // Setup the socket to the use the data from the p2p data channel
                socket.setKeepAlive(true);
                socket.on('data', (chunk) => {
                    // Protect the data channel buffer from getting filled up
                    if (dataChannel.bufferedAmount < MAX_DATA_CHANNEL_BUFFER_SIZE){
                        try {
                            dataChannel.send(chunk);
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
                                    dataChannel.send(chunk);
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
            console.log(chunk);
            peer.destroy();
        }
    });

    return peer;
}

// MAIN -------------------------------------------------------------------------------------------

if (args['--list-available-messengers']) {
    console.log('Available messengers');

    fs.readdirSync(MESSENGER_DIRECTORY).forEach(fileName => {
        console.log(`    ${fileName.replace(/.js$/, '')}`);
    })

    process.exit();
}

if (args['--sdp-messenger']) {
    const messengerScript = `${MESSENGER_DIRECTORY}/${args['--sdp-messenger']}.js`
    if (!fs.existsSync(messengerScript)) {
        console.log(`Messenger not found at ${messengerScript}`);
        process.exit();
    }

    // Add a timestamp to the front of all console logs
    require('log-timestamp');

    // Import messengerScript
    messenger = require(messengerScript);
    if (!messenger) {
        console.log(`Could not load module: ${messengerScript}`);
        process.exit();
    }

    // Setup the messenger module
    console.log(`Using messenger module: ${messengerScript}`);
    messenger.init(config);
    messenger.startListening(
        () => {
            if (args['--verbose'])
                console.log('Messenger ready');
            peerClient = setupP2PStuff()
        },
        (msg) => {
            // If the peer client is already connected then do nothing
            if (!peerClient || peerClient.connected)
                return;

            if (args['--verbose'])
                console.log('Discord message received from server');

            if (args['--print-sdp-strings'])
                printSDP(msg);

            peerClient.signal(JSON.parse(msg));
        }
    );
}

process.on('SIGINT', () => {
    if (args['--verbose'])
        console.log('Ctrl+c: EXITING');

    if (!peerClient)
        peerClient.destroy();

    if (!messenger)
        messenger.stopListening();

    process.exit();
});
*/
