// events
const EVENTS = {
  CONNECTION: "connection",
  MESSAGE: "message",
  CREATE_OR_JOIN: "create_or_join",
  CREATED: "created",
  JOIN: "join",
  JOINED: "joined",
  READY: "ready",
  FULL: "full",
  DISCONNECT: "disconnect",
  LOG: "log",
  USER_JOINED: "user_joined",
  USER_LEFT: "user_left",
  ALL_USERS_IN_ROOM: "all_users_in_room",
};

Vue.createApp({
  setup() {
    const isJoinedRoom = Vue.ref(false);
    const isLoading = Vue.ref(false);
    const localVideo = Vue.ref(null);
    const remoteVideo = Vue.ref(null);
    const connectedUsers = Vue.ref([]);
    const formData = Vue.reactive({
      name: "",
      room: "",
    });

    const isEmptyRoom = Vue.computed(
      () => isJoinedRoom.value && connectedUsers.value?.length <= 1
    );

    const buddyLink = Vue.computed(
      () => `${window.location.origin}/?room=${formData.room}`
    );

    const constraints = {
      audio: true,
      video: true,
    };

    const pcConfig = {
      iceServers: [
        {
          urls: "stun:stun.l.google.com:19302",
        },
        {
          urls: "turn:54.160.108.83:3478?transport=udp",
          username: "mupati",
          credential: "mupati101",
        },
      ],
    };
    const sdpConstraints = {
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    };

    let socket;
    let localStream;
    let remoteStream;
    let isInitiator = false;
    let isChannelReady = false;
    let isStarted = false;
    let pc;

    // Set Opus as the default audio codec if it's present.
    function preferOpus(sdp) {
      let sdpLines = sdp.split("\r\n");
      let mLineIndex;
      // Search for m line.
      for (var i = 0; i < sdpLines.length; i++) {
        if (sdpLines[i].search("m=audio") !== -1) {
          mLineIndex = i;
          break;
        }
      }
      if (mLineIndex === null) {
        return sdp;
      }

      // If Opus is available, set it as the default in m line.
      for (i = 0; i < sdpLines.length; i++) {
        if (sdpLines[i].search("opus/48000") !== -1) {
          const opusPayload = extractSdp(sdpLines[i], /:(\d+) opus\/48000/i);
          if (opusPayload) {
            sdpLines[mLineIndex] = setDefaultCodec(
              sdpLines[mLineIndex],
              opusPayload
            );
          }
          break;
        }
      }

      // Remove CN in m line and sdp.
      sdpLines = removeCN(sdpLines, mLineIndex);

      sdp = sdpLines.join("\r\n");
      return sdp;
    }

    function extractSdp(sdpLine, pattern) {
      const result = sdpLine.match(pattern);
      return result && result.length === 2 ? result[1] : null;
    }

    // Set the selected codec to the first in m line.
    function setDefaultCodec(mLine, payload) {
      const elements = mLine.split(" ");
      const newLine = [];
      let index = 0;
      for (let i = 0; i < elements.length; i++) {
        if (index === 3) {
          // Format of media starts from the fourth.
          newLine[index++] = payload; // Put target payload to the first.
        }
        if (elements[i] !== payload) {
          newLine[index++] = elements[i];
        }
      }
      return newLine.join(" ");
    }

    // Strip CN from sdp before CN constraints is ready.
    function removeCN(sdpLines, mLineIndex) {
      const sdpLinesRes = sdpLines;
      const mLineElements = sdpLines[mLineIndex].split(" ");
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
      sdpLinesRes[mLineIndex] = mLineElements.join(" ");
      return sdpLines;
    }

    function handleRemoteStreamAdded(event) {
      console.log("Remote stream added.");
      remoteStream = event.stream;
      remoteVideo.value.srcObject = remoteStream;
    }

    function handleRemoteStreamRemoved(event) {
      console.log("Remote stream removed. Event: ", event);
    }

    function handleIceCandidate(event) {
      console.log("icecandidate event: ", event);
      if (event.candidate) {
        sendMessage({
          type: "candidate",
          label: event.candidate.sdpMLineIndex,
          id: event.candidate.sdpMid,
          candidate: event.candidate.candidate,
        });
      } else {
        console.log("End of candidates.");
      }
    }

    function createPeerConnection() {
      try {
        pc = new RTCPeerConnection(pcConfig);
        pc.onicecandidate = handleIceCandidate;
        pc.onaddstream = handleRemoteStreamAdded;
        pc.onremovestream = handleRemoteStreamRemoved;
        console.log("Created RTCPeerConnnection");
      } catch (e) {
        console.log(`Failed to create PeerConnection, exception: ${e.message}`);
        alert("Cannot create RTCPeerConnection object.");
      }
    }

    function setLocalAndSendMessage(sessionDescription) {
      // Set Opus as the preferred codec in SDP if Opus is present.
      //  sessionDescription.sdp = preferOpus(sessionDescription.sdp);
      pc.setLocalDescription(sessionDescription);
      console.log("setLocalAndSendMessage sending message", sessionDescription);
      sendMessage(sessionDescription);
    }

    function handleCreateOfferError(event) {
      console.log("createOffer() error: ", event);
    }

    function doCall() {
      console.log("Sending offer to peer");
      pc.createOffer([sdpConstraints])
        .then((offer) => setLocalAndSendMessage(offer))
        .catch(handleCreateOfferError);
    }

    function maybeStart() {
      console.log(
        ">>>>>>> maybeStart() ",
        isStarted,
        localStream,
        isChannelReady
      );
      if (!isStarted && typeof localStream !== "undefined" && isChannelReady) {
        console.log(">>>>>> creating peer connection");
        createPeerConnection();
        pc.addStream(localStream);
        isStarted = true;
        console.log("isInitiator", isInitiator);
        if (isInitiator) {
          doCall();
        }
      }
    }

    function onCreateSessionDescriptionError(error) {
      trace(`Failed to create session description: ${error.toString()}`);
    }

    function doAnswer() {
      console.log("Sending answer to peer.");
      pc.createAnswer()
        .then((answer) => setLocalAndSendMessage(answer))
        .catch(onCreateSessionDescriptionError);
    }

    const initializeWebsocketConnection = ({ name, room }) => {
      socket = io({ query: `name=${name}` });

      socket.emit(EVENTS.CREATE_OR_JOIN, room);
      console.log("Attempted to create or  join room", room);

      socket.on(EVENTS.CREATED, (roomObject) => {
        console.log(`Created room ${roomObject}`);
        isJoinedRoom.value = true;
        isLoading.value = false;
        isInitiator = true;
      });

      socket.on(EVENTS.FULL, (roomObject) => {
        console.log(`Room ${roomObject} is full`);
      });

      socket.on(EVENTS.JOIN, (roomObject) => {
        console.log(`Another peer made a request to join room ${roomObject}`);
        console.log(`This peer is the initiator of room ${roomObject}!`);
        isChannelReady = true;
      });

      socket.on(EVENTS.JOINED, (roomObject) => {
        console.log(`joined: ${roomObject}`);
        isChannelReady = true;
        isJoinedRoom.value = true;
        isLoading.value = false;
      });

      socket.on(EVENTS.LOG, (array) => {
        console.log(...array);
      });

      socket.on(EVENTS.ALL_USERS_IN_ROOM, (allUsers) => {
        console.log("allUsers: ", allUsers);
        connectedUsers.value = allUsers;
      });

      socket.on(EVENTS.USER_JOINED, (user) => {
        console.log("user: ", user);
        // sendMessage("got user media");
        // if (isInitiator) {
        //   maybeStart();
        // }
      });

      socket.on(EVENTS.USER_LEFT, (user) => {
        console.log("user: ", user);
      });

      // This client receives a message
      socket.on(EVENTS.MESSAGE, (message) => {
        console.log("Client received message:", message);
        if (message === "got user media") {
          maybeStart();
        } else if (message.type === "offer") {
          if (!isInitiator && !isStarted) {
            maybeStart();
          }
          pc.setRemoteDescription(new RTCSessionDescription(message));
          doAnswer();
        } else if (message.type === "answer" && isStarted) {
          pc.setRemoteDescription(new RTCSessionDescription(message));
        } else if (message.type === "candidate" && isStarted) {
          const candidate = new RTCIceCandidate({
            sdpMLineIndex: message.label,
            candidate: message.candidate,
          });
          pc.addIceCandidate(candidate);
        } else if (message === "bye" && isStarted) {
          handleRemoteHangup();
        }
      });
    };

    const joinRoom = () => {
      isLoading.value = true;
      initializeWebsocketConnection(formData);

      // turn on your camera
      // getMediaPermission();
    };

    function onLocalStream(stream) {
      localStream = stream;
      localVideo.value.srcObject = stream;
    }

    const getMediaPermission = () => {
      navigator.mediaDevices
        .getUserMedia(constraints)
        .then(onLocalStream)
        .catch((e) => {
          alert(`getUserMedia() error: ${e.name}`);
        });
    };

    const sendMessage = (message) => {
      console.log("Client sending message: ", message);
      socket.emit(EVENTS.MESSAGE, message);
    };

    return {
      joinRoom,
      formData,
      buddyLink,
      isLoading,
      localVideo,
      isEmptyRoom,
      remoteVideo,
      isJoinedRoom,
      connectedUsers,
    };
  },
}).mount("#app");
