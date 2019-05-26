const path = require('path');

const docopt = require('docopt').docopt;

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
    const serverPortConnected = false;

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
        
        // Tell the server to connect to a TCP port on the server's local machine
        peer.send(`p:${args['<serverPort>']}`);
    });
    
    peer.on('data', (chunk) => {
        console.log(chunk);
        if (!serverPortConnected && chunk === 'ok'){
            // The server tells us that it has connected to the port that the user requested and is
            // ready to forward the p2p data stream to it

            // TODO Listen to the TCP port requested by the user on the client local machine

            // TODO Pipe the stream from the client TCP port to the p2p stream

            serverPortConnected = true;
        }
    });

    return peer;
}

// MISC -------------------------------------------------------------------------------------------

process.on('SIGINT', () => {
    console.log('Ctrl+c: EXITING ----------------');
    peerClient.destroy();
    process.exit();

    // TODO Close the TCP port that we were listening to
});
