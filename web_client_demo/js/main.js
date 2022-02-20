/* eslint-disable block-scoped-var */
/* eslint-disable no-plusplus */
/* eslint-disable no-var */
/* eslint-disable no-undef */
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
  // ANSWER: "answer",
  // OFFER: "offer",
};

const MEDIA_DEVICE_KIND = {
  AUDIO_INPUT: "audioinput",
  AUDIO_OUTPUT: "audiooutput",
  VIDEO_INPUT: "videoinput",
};

const DEVICE_NAME = {
  MICROPHONE: "Microphone",
  SPEAKERS: "Speakers",
  CAMERA: "Camera",
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
    const localAudioRef = Vue.ref(null);
    const remoteVideoRef = Vue.ref(null);
    const remoteAudioRef = Vue.ref(null);

    const mediaDeviceState = Vue.ref(null);
    const localMedia = Vue.reactive({
      isMutedMic: false,
    });
    const myInfo = Vue.ref(null);
    const connectedUsers = Vue.ref([]);
    const formData = Vue.reactive({
      name: "",
      room: "",
    });

    const mediaDevices = Vue.computed(() => {
      const groupedDevices = {
        [DEVICE_NAME.MICROPHONE]: [],
        [DEVICE_NAME.SPEAKERS]: [],
        [DEVICE_NAME.CAMERA]: [],
      };
      mediaDeviceState.value?.devices.forEach((device) => {
        if (device.kind === MEDIA_DEVICE_KIND.AUDIO_INPUT) {
          groupedDevices[DEVICE_NAME.MICROPHONE].push(device);
        } else if (device.kind === MEDIA_DEVICE_KIND.AUDIO_OUTPUT) {
          groupedDevices[DEVICE_NAME.SPEAKERS].push(device);
        } else if (device.kind === MEDIA_DEVICE_KIND.VIDEO_INPUT) {
          groupedDevices[DEVICE_NAME.CAMERA].push(device);
        }
      });
      return groupedDevices;
    });

    const mediaSource = Vue.reactive({
      [DEVICE_NAME.MICROPHONE]:
        mediaDevices[MEDIA_DEVICE_KIND.AUDIO_INPUT]?.[0].deviceId,
      [DEVICE_NAME.CAMERA]:
        mediaDevices[MEDIA_DEVICE_KIND.VIDEO_INPUT]?.[0].deviceId,
    });

    const deviceSelection = Vue.reactive({
      [DEVICE_NAME.MICROPHONE]: { active: false, choice: null },
      [DEVICE_NAME.SPEAKERS]: { active: false, choice: null },
      [DEVICE_NAME.CAMERA]: { active: false, choice: null },
    });

    const isEmptyRoom = Vue.computed(
      () => isJoinedRoom.value && connectedUsers.value?.length <= 1
    );

    const buddyLink = Vue.computed(
      () => `${window.location.origin}/?room=${formData.room}`
    );

    const constraints = {
      audio: {
        deviceId: mediaSource[DEVICE_NAME.MICROPHONE]
          ? { exact: mediaSource[DEVICE_NAME.MICROPHONE] }
          : undefined,
      },
      video: {
        deviceId: mediaSource[DEVICE_NAME.CAMERA]
          ? { exact: mediaSource[DEVICE_NAME.CAMERA] }
          : undefined,
      },
    };

    const pcConfig = {
      iceServers: [
        {
          urls: "stun:stun.l.google.com:19302",
        },
        {
          urls: "turn:167.99.220.186:3478?transport=udp",
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
    let localStream;
    let pc;
    let callData;

    // Set Opus as the default audio codec if it's present.
    function preferOpus(sdp) {
      let sdpLines = sdp.split("\r\n");
      let mLineIndex;
      // Search for m line.
      // eslint-disable-next-line vars-on-top
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
          // eslint-disable-next-line no-use-before-define
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

    const sendMessage = (message) => {
      console.log("Client sending message: ", message);
      socket.emit(EVENTS.MESSAGE, message);
    };

    async function handleRemoteStreamAdded(event) {
      console.log("Remote stream added.");
      // const remoteAudioContext = new AudioContext();
      // const pan = remoteAudioContext.createStereoPanner();
      // const dest = remoteAudioContext.createMediaStreamDestination();
      // pan.connect(dest);
      // pan.pan.value = 1;
      // remoteAudioRef.value.srcObject = dest.stream;
      // remoteAudioContext.resume();
      // const source = remoteAudioContext.createMediaStreamSource(event.stream);
      // source.connect(pan);

      // remoteStream = event.stream;
      remoteVideoRef.value.srcObject = event.stream;
      await remoteVideoRef.value?.play();
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

    const handleNegotiation = async (event) => {
      console.log("negotiation event: ", event);

      // try {
      //   const offer = await pc.createOffer([sdpConstraints]);
      //   // Set Opus as the preferred codec in SDP if Opus is present.
      //   offer.sdp = preferOpus(offer.sdp);
      //   pc.setLocalDescription(offer);
      //   sendMessage(offer);
      // } catch (error) {
      //   console.log(error);
      // }
    };

    // const sendSdpAnswer = async () => {
    //   const answer = await pc.createAnswer();
    //   // Set Opus as the preferred codec in SDP if Opus is present.
    //   answer.sdp = preferOpus(answer.sdp);
    //   pc.setLocalDescription(answer);
    //   sendMessage(answer);
    // };

    function handleConnectionStateChange(event) {
      console.log("handleConnectionStateChange event: ", event);
    }

    function createPeerConnection() {
      try {
        pc = new RTCPeerConnection(pcConfig);
        pc.onicecandidate = handleIceCandidate;
        pc.onaddstream = handleRemoteStreamAdded;
        pc.ontrack = ({ streams: [stream] }) => {
          remoteVideoRef.value.srcObject = stream;
        };
        pc.onremovestream = handleRemoteStreamRemoved;
        pc.onnegotiationneeded = handleNegotiation;
        pc.onconnectionstatechange = handleConnectionStateChange;
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
        }
        // else if (message.type === MESSAGE_TYPE.OFFER) {
        //   console.log("sdp offer: ", message);
        //   pc.setRemoteDescription(new RTCSessionDescription(message));
        //   sendSdpAnswer();
        // } else if (message.type === MESSAGE_TYPE.ANSWER) {
        //   console.log("sdp answer: ", message);
        //   pc.setRemoteDescription(new RTCSessionDescription(message));
        // }
        else if (message.type === MESSAGE_TYPE.ANSWER_USER) {
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

    const getState = async () => {
      const { browserDetails } = adapter;
      let hasCameraPermission;
      let hasMicrophonePermission;

      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasCamera = !!devices.find((d) => d.kind === "videoinput");
      const hasMicrophone = !!devices.find((d) => d.kind === "audioinput");
      if (browserDetails.browser === "chrome" && browserDetails.version >= 86) {
        // Maybe only do this from Chrome 86 onward.
        hasCameraPermission =
          (await navigator.permissions.query({ name: "camera" })).state ===
          "granted";
        hasMicrophonePermission =
          (await navigator.permissions.query({ name: "microphone" })).state ===
          "granted";
      } else {
        hasCameraPermission = !!devices.find(
          (d) => d.kind === "videoinput" && d.label !== ""
        );
        hasMicrophonePermission = !!devices.find(
          (d) => d.kind === "audioinput" && d.label !== ""
        );
      }

      return {
        devices,
        hasCamera,
        hasCameraPermission,
        hasMicrophone,
        hasMicrophonePermission,
      };
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

    const getLocalMediaStream = async () => {
      try {
        // const localAudioContext = new AudioContext();
        // const pan = localAudioContext.createStereoPanner();
        // const dest = localAudioContext.createMediaStreamDestination();
        // pan.connect(dest);
        // pan.pan.value = -1;
        // localAudioRef.value.srcObject = dest.stream;
        const stream = await getMediaPermission();
        // localAudioContext.resume();
        // const source = localAudioContext.createMediaStreamSource(stream);
        // source.connect(pan);

        localStream = stream;
        localVideoRef.value.srcObject = stream;
        mediaDeviceState.value = await getState();
      } catch (error) {
        console.log(error);
      }
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
        await getLocalMediaStream();
        createPeerConnection();
        // pc.addStream(localStream);
        localStream
          .getTracks()
          .forEach((track) => pc.addTrack(track, localStream));
        const offer = await pc.createOffer([sdpConstraints]);
        // Set Opus as the preferred codec in SDP if Opus is present.
        offer.sdp = preferOpus(offer.sdp);
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
        await getLocalMediaStream();
        createPeerConnection();
        // pc.addStream(localStream);
        localStream
          .getTracks()
          .forEach((track) => pc.addTrack(track, localStream));
        pc.setRemoteDescription(new RTCSessionDescription(callData.sdpData));
        const answer = await pc.createAnswer();
        // Set Opus as the preferred codec in SDP if Opus is present.
        answer.sdp = preferOpus(answer.sdp);
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

    // Change Camera and Microphone source
    const changeMicCamSource = async () => {
      console.log("changingMicCamSource");
      if (localVideoRef.value) stopVideoStream(localVideoRef.value);
      await getLocalMediaStream();
    };

    const changeAudioOutput = (element, sinkId) => {
      // Attach audio output device to video element using device/sink ID.
      if (typeof element.sinkId !== "undefined") {
        element
          .setSinkId(sinkId)
          .then(() => {
            console.log(`Success, audio output device attached: ${sinkId}`);
          })
          .catch((error) => {
            let errorMessage = error;
            if (error.name === "SecurityError") {
              errorMessage = `You need to use HTTPS for selecting audio output device: ${error}`;
            }
            console.error(errorMessage);
            // Jump back to first output device in the list as it's the default.
            deviceSelection[DEVICE_NAME.SPEAKERS].choice =
              mediaDevices[DEVICE_NAME.SPEAKERS][0].label;
          });
      } else {
        console.warn("Browser does not support output device selection.");
      }
    };

    const chooseMediaSource = async (deviceName, device = null) => {
      if (device && deviceSelection[deviceName].choice !== device.label) {
        deviceSelection[deviceName].choice = device.label;
        if (deviceName === DEVICE_NAME.SPEAKERS) {
          changeAudioOutput(localVideoRef.value, device.deviceId);
        } else if (mediaSource?.[deviceName] !== device.deviceId) {
          mediaSource[deviceName] = device.deviceId;
          console.log(
            "after the update: mediaSource[deviceName]: ",
            mediaSource[deviceName]
          );
          await changeMicCamSource();
        }
      }
      deviceSelection[deviceName].active = !deviceSelection[deviceName].active;
    };

    Vue.onMounted(async () => {
      const params = new URL(document.location).searchParams;
      const room = params.get("room");
      if (room) {
        formData.room = room;
      }
    });

    const disableSpeakerSelect = !("sinkId" in HTMLMediaElement.prototype);
    window.onbeforeunload = hangUp;

    return {
      hangUp,
      joinRoom,
      formData,
      placeCall,
      buddyLink,
      isCalling,
      isLoading,
      answerCall,
      localMedia,
      isRoomFull,
      declineCall,
      isEmptyRoom,
      isJoinedRoom,
      localVideoRef,
      remoteVideoRef,
      connectedUsers,
      toggleMicrophone,
      isIncomingCall,
      incomingCallInfo,
      callConnected,
      callingNotification,
      mediaDevices,
      chooseMediaSource,
      deviceSelection,
      disableSpeakerSelect,
      mediaDeviceState,
      localAudioRef,
      remoteAudioRef,
    };
  },
}).mount("#app");
