// events
const EVENTS = {
  CONNECTION: "connection",
  MESSAGE: "message",
  CREATE_OR_JOIN: "create_or_join",
  CREATED: "created",
  JOIN: "join",
  JOINED: "joined",
  FULL: "full",
  LOG: "log",
  USER_JOINED: "user_joined",
  USER_LEFT: "user_left",
  ALL_USERS_IN_ROOM: "all_users_in_room",
};

const MESSAGE_TYPE = {
  CANDIDATE: "candidate",
  CALL_USER: "call_user",
  ANSWER_USER: "answer_user",
  DECLINE_CALL: "decline_call",
  HANG_UP: "hang_up",
};

Vue.createApp({
  setup() {
    const isJoinedRoom = Vue.ref(false);
    const isRoomFull = Vue.ref(false);
    const isLoading = Vue.ref(false);
    const isCalling = Vue.ref(false);
    const callingNotification = Vue.ref("");
    const isIncomingCall = Vue.ref(false);
    const incomingCallInfo = Vue.ref(null);
    const callConnected = Vue.ref(false);
    const localVideoRef = Vue.ref(null);
    const remoteVideoRef = Vue.ref(null);
    const localMedia = Vue.reactive({
      isMutedMic: false,
    });

    const remoteMedia = Vue.reactive({
      isMutedMic: false,
    });

    const myInfo = Vue.ref(null);
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

    Vue.onMounted(() => {
      const params = new URL(document.location).searchParams;
      const room = params.get("room");
      if (room) {
        formData.room = room;
      }
    });

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
    let remoteStream;
    let pc;
    let callData;

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
      remoteVideoRef.value.srcObject = remoteStream;
    }

    function handleRemoteStreamRemoved(event) {
      console.log("Remote stream removed. Event: ", event);
    }

    function handleIceCandidate(event) {
      console.log("icecandidate event: ", event);
      if (event.candidate) {
        sendMessage({
          type: MESSAGE_TYPE.CANDIDATE,
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
    const initializeWebsocketConnection = ({ name, room }) => {
      socket = io({ query: `name=${name}` });

      socket.emit(EVENTS.CREATE_OR_JOIN, room);
      console.log("Attempted to create or  join room", room);

      socket.on(EVENTS.CREATED, (roomObject, user) => {
        console.log(`Created room ${roomObject}`);
        myInfo.value = user;
        isJoinedRoom.value = true;
        isLoading.value = false;
      });

      socket.on(EVENTS.FULL, (roomObject) => {
        console.log(`Room ${roomObject} is full`);
        isLoading.value = false;
        isRoomFull.value = true;
      });

      socket.on(EVENTS.JOIN, (roomObject) => {
        console.log(`Another peer made a request to join room ${roomObject}`);
        console.log(`This peer is the initiator of room ${roomObject}!`);
      });

      socket.on(EVENTS.JOINED, (roomObject, user) => {
        console.log(`joined: ${roomObject}`);
        myInfo.value = user;
        isJoinedRoom.value = true;
        isLoading.value = false;
      });

      socket.on(EVENTS.LOG, (array) => {
        console.log(...array);
      });

      socket.on(EVENTS.ALL_USERS_IN_ROOM, (allUsers) => {
        connectedUsers.value = allUsers;
      });

      socket.on(EVENTS.USER_JOINED, (user) => {
        console.log("user: ", user);
      });

      socket.on(EVENTS.USER_LEFT, (user) => {
        console.log("user: ", user);
      });

      // This client receives a message
      socket.on(EVENTS.MESSAGE, (message) => {
        console.log("Client received message:", message);
        if (message.type === MESSAGE_TYPE.CANDIDATE) {
          const candidate = new RTCIceCandidate({
            sdpMLineIndex: message.label,
            candidate: message.candidate,
          });
          if (pc) pc.addIceCandidate(candidate);
        } else if (message.type === MESSAGE_TYPE.ANSWER_USER) {
          if (message.receiver.id === myInfo.value.id) {
            pc.setRemoteDescription(new RTCSessionDescription(message.sdpData));
            callConnected.value = true;
            isCalling.value = false;
          }
        } else if (message.type === MESSAGE_TYPE.DECLINE_CALL) {
          if (message.receiver.id === myInfo.value.id) {
            callingNotification.value = "The call was rejected";
            setTimeout(() => {
              isCalling.value = false;
              hangUp();
            }, 5000);
          }
        } else if (message.type === MESSAGE_TYPE.CALL_USER) {
          // you got an incoming call if you are the receiver
          if (message.receiver.id === myInfo.value.id) {
            isIncomingCall.value = true;
            incomingCallInfo.value = message.caller;
            callData = message;
          }
        } else if (message.type === MESSAGE_TYPE.HANG_UP) {
          hangUp();
        }
      });
    };

    const joinRoom = () => {
      isLoading.value = true;
      initializeWebsocketConnection(formData);
    };

    const getMediaPermission = () =>
      new Promise((resolve, reject) => {
        navigator.mediaDevices
          .getUserMedia(constraints)
          .then((stream) => {
            resolve(stream);
          })
          .catch((err) => {
            reject(err);
          });
      });

    const sendMessage = (message) => {
      console.log("Client sending message: ", message);
      socket.emit(EVENTS.MESSAGE, message);
    };

    const toggleMicrophone = () => {
      if (localMedia.isMutedMic) {
        localVideoRef.value.srcObject.getAudioTracks()[0].enabled = true;
        localMedia.isMutedMic = false;
      } else {
        localVideoRef.value.srcObject.getAudioTracks()[0].enabled = false;
        localMedia.isMutedMic = true;
      }
    };

    const placeCall = async (receiverInfo) => {
      try {
        const stream = await getMediaPermission();
        localVideoRef.value.srcObject = stream;
        createPeerConnection();
        pc.addStream(stream);
        const offer = await pc.createOffer([sdpConstraints]);
        pc.setLocalDescription(offer);
        sendMessage({
          type: MESSAGE_TYPE.CALL_USER,
          caller: myInfo.value,
          receiver: receiverInfo,
          sdpData: offer,
        });
        isCalling.value = true;
        callingNotification.value = `Calling ${receiverInfo.name}...`;
      } catch (error) {
        console.log(error);
      }
    };

    const answerCall = async () => {
      try {
        const stream = await getMediaPermission();
        localVideoRef.value.srcObject = stream;
        if (!pc) createPeerConnection();
        pc.addStream(stream);
        pc.setRemoteDescription(new RTCSessionDescription(callData.sdpData));
        const answer = await pc.createAnswer();
        pc.setLocalDescription(answer);
        sendMessage({
          type: MESSAGE_TYPE.ANSWER_USER,
          receiver: callData.caller,
          sdpData: answer,
        });
        callConnected.value = true;
      } catch (error) {
        console.log(error);
      }
    };

    const stopVideoStream = (videoElem) => {
      const stream = videoElem.srcObject;
      const tracks = stream.getTracks();
      console.log("stopping tracks: ", tracks);
      tracks.forEach((track) => {
        track.stop();
      });
      videoElem.srcObject = null;
    };

    const hangUp = () => {
      if (localVideoRef.value.srcObject) stopVideoStream(localVideoRef.value);
      if (remoteVideoRef.value.srcObject) stopVideoStream(remoteVideoRef.value);
      if (pc) {
        pc.close();
        pc = null;
      }
      // if there is an existing or outgoing call session, send a hang up message
      if (callConnected.value || isCalling.value) {
        sendMessage({
          type: MESSAGE_TYPE.HANG_UP,
        });
      }
      callConnected.value = false;
      isIncomingCall.value = false;
      isCalling.value = false;
    };

    const declineCall = () => {
      sendMessage({
        type: MESSAGE_TYPE.DECLINE_CALL,
        receiver: callData.caller,
      });
      hangUp();
    };

    return {
      joinRoom,
      formData,
      buddyLink,
      isLoading,
      isRoomFull,
      localVideoRef,
      isEmptyRoom,
      remoteVideoRef,
      isJoinedRoom,
      connectedUsers,
      toggleMicrophone,
      isIncomingCall,
      incomingCallInfo,
      placeCall,
      answerCall,
      declineCall,
      hangUp,
      isCalling,
      callingNotification,
      localMedia,
      remoteMedia,
      callConnected,
    };
  },
}).mount("#app");
