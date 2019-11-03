#!/usr/bin/env node

const path = require('path');
const randomBytes = require('randombytes');

const docopt = require('docopt').docopt;
const net = require('net');

const config = require('./config.json');

const wrtc = require('wrtc');
const Peer = require('simple-peer');

const Discord = require('discord.js');
const fetch = require('node-fetch');

// PARSE COMMAND LINE ARGUMENTS -------------------------------------------------------------------

const doc = `
Usage:
    ${path.basename(__filename)} <localPort> <serverPort>
    ${path.basename(__filename)} -h | --help
`

const args = docopt(doc);
console.log(args);

// GLOBALS ----------------------------------------------------------------------------------------

// To prevent data channel duffer of 16Mb from getting filled up which causes the data channel to
// completely stop working
const MAX_DATA_CHANNEL_BUFFER_SIZE = 2 * 1024 * 1024; // 2Mb
const DATA_CHANNEL_LOW_CHECK_INTERVAL = 100; // milliseconds

// This will be initialized later once the signalling stuff is ready
let peerClient;

// FUNCTIONS --------------------------------------------------------------------------------------

function askForInput(promptStr, callback){
    const readline = require('readline').createInterface({                                                                                                                                                              
        input: process.stdin,                                                                                                                                                                                           
        output: process.stdout                                                                                                                                                                                          
    });                                                                                                                                                                                                                 

    readline.question(promptStr, (signalData) => {                                                                                                                                                      
        callback(signalData);
        readline.close();                                                                                                                                                                                               
    });
}

function sendDiscordMessage(msg, callback){
    fetch(`https://discordapp.com/api/channels/${config.discordChannelId}/messages`, {
        method: 'post',
        body: JSON.stringify({
            content: msg
        }),
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bot ${config.discordClientBot.token}`
        }
    }).then((res) => { callback(res) });
}

// SIGNALLING -------------------------------------------------------------------------------------
// Using Discord

const discordClient = new Discord.Client();

discordClient.on('ready', () => {
    console.log('Discord ready');
    peerClient = setupP2PStuff()
});

discordClient.on('message', (msg) => {
    if (peerClient && !peerClient.connected && msg.author.tag === config.discordServerBot.tag){
        const dataObj = JSON.parse(msg.content);

        console.log('Discord message received from server');
        console.log(dataObj);

        peerClient.signal(dataObj);
    }
});

discordClient.login(config.discordClientBot.token);

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
        console.log('Signal generated');
        const signalStr = JSON.stringify(signalData);

        // Initiate the message
        sendDiscordMessage(signalStr, (res) => {console.log('Signal string sent to server')});
    });
    
    peer.on('connect', () => {
        console.log('Peer connected');
        
        // Tell the server to connect to a TCP port on the server's local machine
        peer.send(`p:${args['<serverPort>']}`);

        console.log(peer._channel.bufferedAmountLowThreshold);
    });
    
    peer.on('data', (chunk) => {
        if (serverPortConnected) return 

        chunk = '' + chunk;
        if (chunk === 'ok'){
            // The server tells us that it has connected to the port that the user requested and is
            // ready to forward the p2p data stream to it
            console.log(`Peer server listening on port ${args['<serverPort>']}`);

            const tcpServer = new net.createServer((socket) => {
                console.log(`Something connected to local port ${args['<localPort>']}`);

                // Create a new data channel on the peer with a random name
                const dataChannel = peer._pc.createDataChannel('custom_' + randomBytes(20).toString('hex'))
                dataChannel.binaryType = 'arraybuffer';
                dataChannel.onmessage = (event) => {
                    const chunk = Buffer.from(event.data);
                    socket.write(chunk);
                }
                dataChannel.onclose = () => {
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
                    console.log(`TCP socket connection ended`) 
                    dataChannel.close();
                });
                socket.on('close', () => {
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

// MISC -------------------------------------------------------------------------------------------

process.on('SIGINT', () => {
    console.log('Ctrl+c: EXITING ----------------');
    peerClient.destroy();
    process.exit();
});
