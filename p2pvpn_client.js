const path = require('path');

const server = require('express')();

const wrtc = require('wrtc');
const Peer = require('simple-peer');

// GLOBALS ----------------------------------------------------------------------------------------

const HTTP_PORT = 2098;

const peerClient = new Peer({
    initiator: true,
    wrtc: wrtc,
    trickle: false
});

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

// P2P STUFF --------------------------------------------------------------------------------------

peerClient.on('error', (err) => {
    console.log('ERROR --------------------------');
    console.log(err);
});

peerClient.on('signal', (signalData) => {
    console.log('SIGNAL -------------------------');
    console.log(JSON.stringify(signalData))//.replace(/\\r\\n/g, ' '));

    askForInput('Enter server peer signal string: ', (data) => {
        console.log('GOT SIGNAL -----------------');
        const dataObj = JSON.parse(data);
        console.log(dataObj);
        peerClient.signal(dataObj);
    });
});

peerClient.on('connect', () => {
    console.log('CONNECT ------------------------');
});

peerClient.on('data', (data) => {
    console.log('> ' + data + '\n');
    askForInput('< ', (data) => {
        peerClient.send(data);
    });
});

// HTTP SERVER ------------------------------------------------------------------------------------

server.listen(HTTP_PORT, (err) => {
    if (err) console.log('ERROR: ' + err);
    console.log(`DAT client running on ${HTTP_PORT}`);
});

// Catch all REST calls to this port
server.all('*', (req, res, next) => {
    console.log(req.url);

    const stream = datObj.archive.createWriteStream('abc');
    req.pipe(stream);
    res.send(req.url);
});
