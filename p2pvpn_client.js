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
let signalStr;

// FUNCTIONS --------------------------------------------------------------------------------------

function printHelp(){
    console.error(`Usage: node ${path.basename(__filename)} <httpPort> <key>`);
}

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

function sendDiscordMessage(msg){
    fetch(`https://discordapp.com/api/channels/${config.discordChannelId}/messages`, {
        method: 'post',
        body: JSON.stringify({
            content: msg
        }),
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bot ${config.discordClientBot.token}`
        }
    }).then((res) => {
        console.log('MESSAGE SENT ---------------');
        //console.log(res);
    });
}

// SIGNALLING -------------------------------------------------------------------------------------
// Using Discord

const discordClient = new Discord.Client();

discordClient.on('ready', () => {
    console.log('DISCORD READY ------------------');
    console.log(`User: ${discordClient.user.tag}`);
    console.log(`Channels: ${discordClient.channels.array()}`);

    // We have to make sure that the Discord stuff is ready before we can generate the signal
    // string and try to send it over discord
    runP2PStuff()
});

discordClient.on('message', (msg) => {
    console.log('DISCORD MESSAGE ----------------');
    console.log(msg.content);

    if (msg.author.tag === config.discordServerBot.tag){
        const dataObj = JSON.parse(msg.content);
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
        console.log('ERROR --------------------------');
        console.log(err);
    });
    
    peerClient.on('signal', (signalData) => {
        console.log('SIGNAL -------------------------');
        signalStr = JSON.stringify(signalData);
        
        console.log(signalStr);

        // Initiate the message
        sendDiscordMessage(signalStr);
    
        //askForInput('Enter server peer signal string: ', (data) => {
        //    console.log('GOT SIGNAL -----------------');
        //    const dataObj = JSON.parse(data);
        //    console.log(dataObj);
        //    peerClient.signal(dataObj);
        //});
    });
    
    peerClient.on('connect', () => {
        console.log('CONNECT ------------------------');
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
