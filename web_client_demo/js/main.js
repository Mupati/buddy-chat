let isChannelReady = false;
let isInitiator = false;
let isStarted = false;
let localStream;
let pc;
let remoteStream;

const pcConfig = {
  iceServers: [{
    urls: 'stun:stun.l.google.com:19302',
  }],
};

// Set up audio and video regardless of what devices are present.
const sdpConstraints = {
  offerToReceiveAudio: true,
  offerToReceiveVideo: true,
};

const localVideo = document.querySelector('#localVideo');
const remoteVideo = document.querySelector('#remoteVideo');

const constraints = {
  audio: false,
  video: true,
};

/// //////////////////////////////////////////

const room = 'foo';
// Could prompt for room name:
// room = prompt('Enter room name:');

const socket = io();
// const socket = io("ws://localhost:80");

if (room !== '') {
  socket.emit('create or join', room);
  console.log('Attempted to create or  join room', room);
}

socket.on('created', (roomObject) => {
  console.log(`Created room ${roomObject}`);
  isInitiator = true;
});

socket.on('full', (roomObject) => {
  console.log(`Room ${roomObject} is full`);
});

socket.on('join', (roomObject) => {
  console.log(`Another peer made a request to join room ${roomObject}`);
  console.log(`This peer is the initiator of room ${roomObject}!`);
  isChannelReady = true;
});

socket.on('joined', (roomObject) => {
  console.log(`joined: ${roomObject}`);
  isChannelReady = true;
});

socket.on('log', (array) => {
  console.log(...array);
});

function sendMessage(message) {
  console.log('Client sending message: ', message);
  socket.emit('message', message);
}

/// /////////////////////////////////////////////

function handleRemoteStreamAdded(event) {
  console.log('Remote stream added.');
  remoteStream = event.stream;
  remoteVideo.srcObject = remoteStream;
}

function handleRemoteStreamRemoved(event) {
  console.log('Remote stream removed. Event: ', event);
}

function handleIceCandidate(event) {
  console.log('icecandidate event: ', event);
  if (event.candidate) {
    sendMessage({
      type: 'candidate',
      label: event.candidate.sdpMLineIndex,
      id: event.candidate.sdpMid,
      candidate: event.candidate.candidate,
    });
  } else {
    console.log('End of candidates.');
  }
}

function createPeerConnection() {
  try {
    pc = new RTCPeerConnection(pcConfig);
    pc.onicecandidate = handleIceCandidate;
    pc.onaddstream = handleRemoteStreamAdded;
    pc.onremovestream = handleRemoteStreamRemoved;
    console.log('Created RTCPeerConnnection');
  } catch (e) {
    console.log(`Failed to create PeerConnection, exception: ${e.message}`);
    alert('Cannot create RTCPeerConnection object.');
  }
}

function setLocalAndSendMessage(sessionDescription) {
  // Set Opus as the preferred codec in SDP if Opus is present.
  //  sessionDescription.sdp = preferOpus(sessionDescription.sdp);
  pc.setLocalDescription(sessionDescription);
  console.log('setLocalAndSendMessage sending message', sessionDescription);
  sendMessage(sessionDescription);
}

function handleCreateOfferError(event) {
  console.log('createOffer() error: ', event);
}

function doCall() {
  console.log('Sending offer to peer');
  pc.createOffer([sdpConstraints])
    .then((offer) => setLocalAndSendMessage(offer))
    .catch(handleCreateOfferError);
}

function maybeStart() {
  console.log('>>>>>>> maybeStart() ', isStarted, localStream, isChannelReady);
  if (!isStarted && typeof localStream !== 'undefined' && isChannelReady) {
    console.log('>>>>>> creating peer connection');
    createPeerConnection();
    pc.addStream(localStream);
    isStarted = true;
    console.log('isInitiator', isInitiator);
    if (isInitiator) {
      doCall();
    }
  }
}

function onCreateSessionDescriptionError(error) {
  trace(`Failed to create session description: ${error.toString()}`);
}

function doAnswer() {
  console.log('Sending answer to peer.');
  pc.createAnswer()
    .then((answer) => setLocalAndSendMessage(answer))
    .catch(onCreateSessionDescriptionError);
}

/// /////////////////////////////////////////////

console.log('Getting user media with constraints', constraints);

function gotStream(stream) {
  console.log('Adding local stream.');
  localStream = stream;
  localVideo.srcObject = stream;
  sendMessage('got user media');
  if (isInitiator) {
    maybeStart();
  }
}

navigator.mediaDevices.getUserMedia(constraints)
  .then(gotStream)
  .catch((e) => {
    alert(`getUserMedia() error: ${e.name}`);
  });

/// /////////////////////////////////////////////

function stop() {
  isStarted = false;
  pc.close();
  pc = null;
}

function handleRemoteHangup() {
  console.log('Session terminated.');
  stop();
  isInitiator = false;
}

// This client receives a message
socket.on('message', (message) => {
  console.log('Client received message:', message);
  if (message === 'got user media') {
    maybeStart();
  } else if (message.type === 'offer') {
    if (!isInitiator && !isStarted) {
      maybeStart();
    }
    pc.setRemoteDescription(new RTCSessionDescription(message));
    doAnswer();
  } else if (message.type === 'answer' && isStarted) {
    pc.setRemoteDescription(new RTCSessionDescription(message));
  } else if (message.type === 'candidate' && isStarted) {
    const candidate = new RTCIceCandidate({
      sdpMLineIndex: message.label,
      candidate: message.candidate,
    });
    pc.addIceCandidate(candidate);
  } else if (message === 'bye' && isStarted) {
    handleRemoteHangup();
  }
});

/// /////////////////////////////////////////////////

window.onbeforeunload = function bye() {
  sendMessage('bye');
};

function hangup() {
  console.log('Hanging up.');
  stop();
  sendMessage('bye');
}

/// ////////////////////////////////////////

// Set Opus as the default audio codec if it's present.
function preferOpus(sdp) {
  let sdpLines = sdp.split('\r\n');
  let mLineIndex;
  // Search for m line.
  for (var i = 0; i < sdpLines.length; i++) {
    if (sdpLines[i].search('m=audio') !== -1) {
      mLineIndex = i;
      break;
    }
  }
  if (mLineIndex === null) {
    return sdp;
  }

  // If Opus is available, set it as the default in m line.
  for (i = 0; i < sdpLines.length; i++) {
    if (sdpLines[i].search('opus/48000') !== -1) {
      const opusPayload = extractSdp(sdpLines[i], /:(\d+) opus\/48000/i);
      if (opusPayload) {
        sdpLines[mLineIndex] = setDefaultCodec(
          sdpLines[mLineIndex],
          opusPayload,
        );
      }
      break;
    }
  }

  // Remove CN in m line and sdp.
  sdpLines = removeCN(sdpLines, mLineIndex);

  sdp = sdpLines.join('\r\n');
  return sdp;
}

function extractSdp(sdpLine, pattern) {
  const result = sdpLine.match(pattern);
  return result && result.length === 2 ? result[1] : null;
}

// Set the selected codec to the first in m line.
function setDefaultCodec(mLine, payload) {
  const elements = mLine.split(' ');
  const newLine = [];
  let index = 0;
  for (let i = 0; i < elements.length; i++) {
    if (index === 3) { // Format of media starts from the fourth.
      newLine[index++] = payload; // Put target payload to the first.
    }
    if (elements[i] !== payload) {
      newLine[index++] = elements[i];
    }
  }
  return newLine.join(' ');
}

// Strip CN from sdp before CN constraints is ready.
function removeCN(sdpLines, mLineIndex) {
  const sdpLinesRes = sdpLines;
  const mLineElements = sdpLines[mLineIndex].split(' ');
  // Scan from end for the convenience of removing an item.
  for (let i = sdpLines.length - 1; i >= 0; i--) {
    const payload = extractSdp(sdpLines[i], /a=rtpmap:(\d+) CN\/\d+/i);
    if (payload) {
      const cnPos = mLineElements.indexOf(payload);
      if (cnPos !== -1) {
        // Remove CN payload from m line.
        mLineElements.splice(cnPos, 1);
      }
      // Remove CN line in sdp
      sdpLines.splice(i, 1);
    }
  }
  sdpLinesRes[mLineIndex] = mLineElements.join(' ');
  return sdpLines;
}
