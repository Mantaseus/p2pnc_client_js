const path = require('path');

const config = require('./config.json');

const wrtc = require('wrtc');
const Peer = require('simple-peer');

const Discord = require('discord.js');
const server = require('express')();
const fetch = require('node-fetch');

// GLOBALS ----------------------------------------------------------------------------------------

const HTTP_PORT = 2098;

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
    if (peerClient && msg.author.tag === config.discordServerBot.tag){
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
    const requestCallbacks = {};
    let requestCallIdCount = 0;

    // Add a new function to the peer object to send requests to server and be able to send
    // the results back to the appropriate caller through the 'callback'
    // If 'data' is supposed to be a JSON object then don't stringify it. Just pass it in as a
    // normal object
    peer.sendForResult = (data, callback) => {
        console.log(data);

        // Housekeeping to keep track of which callback is attached with which request
        requestCallIdCount += 1;
        requestCallbacks[requestCallIdCount] = callback;

        peer.send(JSON.stringify({
            id: requestCallIdCount,
            request: data
        }));
    }

    peer.on('error', (err) => {
        console.log('ERROR ------------------------');
        console.log(err);
    });

    peer.on('close', () => {
        console.log('Connection closed');
    });
    
    peer.on('signal', (signalData) => {
        console.log('Signal generated');
        const signalStr = JSON.stringify(signalData);

        // Initiate the message
        sendDiscordMessage(signalStr, (res) => {console.log('Signal string sent to server')});
    });
    
    peer.on('connect', () => {
        console.log('CONNECTED --------------------');
    });
    
    peer.on('data', (data) => {
        try {
            // All valid results should be JSON objects
            data = JSON.parse(data);
            requestCallbacks[data.id](data.result);
        } catch(e) {
            // The resturned string was probably not a JSON object so just console.log it
            console.log('> ' + data + '\n');
        }
    });

    return peer;
}

// HTTP SERVER ------------------------------------------------------------------------------------

server.listen(HTTP_PORT, (err) => {
    if (err) console.log('ERROR: ' + err);
    console.log(`p2pvpn running on ${HTTP_PORT}`);
});

// Catch all REST calls to this port
server.all('*', (req, res, next) => {
    console.log('url: ' + req.url);

    peerClient.sendForResult(req.url, (result) => {
        console.log(result);
        res.send(result);
    });
});

// MISC -------------------------------------------------------------------------------------------

process.on('exit', () => {
    console.log('EXITING ------------------------');
    peerClient.destroy();
    process.exit();
});

process.on('SIGINT', () => {
    console.log('Ctrl+c: EXITING ----------------');
    peerClient.destroy();
    peerClient.sendForResult('Sending for result');
    process.exit();
});
