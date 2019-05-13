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
    runP2PStuff()
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

function runP2PStuff(){
    peerClient = new Peer({
        initiator: true,
        wrtc: wrtc,
        trickle: false
    });
    
    peerClient.on('error', (err) => {
        console.log('ERROR ------------------------');
        console.log(err);
    });

    peerClient.on('close', () => {
        console.log('Connection closed');
    });
    
    peerClient.on('signal', (signalData) => {
        console.log('Signal generated');
        const signalStr = JSON.stringify(signalData);

        // Initiate the message
        sendDiscordMessage(signalStr, (res) => {console.log('Signal string sent to server')});
    });
    
    peerClient.on('connect', () => {
        console.log('CONNECTED --------------------');
    });
    
    peerClient.on('data', (data) => {
        // Ask for user input for simple testing
        console.log('> ' + data + '\n');
        askForInput('< ', (data) => {
            peerClient.send(data);
        });
    });
}

// HTTP SERVER ------------------------------------------------------------------------------------

server.listen(HTTP_PORT, (err) => {
    if (err) console.log('ERROR: ' + err);
    console.log(`p2pvpn running on ${HTTP_PORT}`);
});

// Catch all REST calls to this port
server.all('*', (req, res, next) => {
    console.log(req.url);
    res.send(req.url);
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
    process.exit();
});
