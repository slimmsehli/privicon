const socket = io();

// Shared variables
let localStream;
let screenStream;
const peers = {};
let isCameraOn = true;
let isMuted = false;
let isRecording = false;
let isSharingScreen = false;
let mediaRecorder;
let recordedChunks = [];

// Initialize local video
function initializeLocalVideo(containerId) {
  const localVideo = document.createElement('video');
  localVideo.autoplay = true;
  localVideo.muted = true;
  localVideo.className = 'participant-video';
  const localContainer = document.createElement('div');
  localContainer.className = 'participant';
  localContainer.appendChild(localVideo);
  document.getElementById(containerId).appendChild(localContainer);
  return localVideo;
}

// Start video and audio with user preferences
async function startVideo(videoEnabled = true, audioEnabled = true) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: videoEnabled,
      audio: audioEnabled,
    });
    isCameraOn = videoEnabled;
    isMuted = !audioEnabled;

    // Set initial track states
    if (localStream) {
      if (!videoEnabled) {
        localStream.getVideoTracks()[0].enabled = false;
      }
      if (!audioEnabled) {
        localStream.getAudioTracks()[0].enabled = false;
      }
    }

    return localStream;
  } catch (err) {
    console.error('Error accessing media devices:', err);
    return null;
  }
}

// Toggle camera
function toggleCamera() {
  if (localStream) {
    isCameraOn = !isCameraOn;
    localStream.getVideoTracks()[0].enabled = isCameraOn;
    return isCameraOn;
  }
  return false;
}

// Toggle mute
function toggleMute() {
  if (localStream) {
    isMuted = !isMuted;
    localStream.getAudioTracks()[0].enabled = !isMuted;
    return isMuted;
  }
  return false;
}

// Create a WebRTC peer connection
function createPeer(userId, callerId, initiator = true) {
  const peer = new SimplePeer({
    initiator,
    stream: localStream,
    trickle: false,
    config: {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    },
  });

  peer.on('signal', (signal) => {
    socket.emit('signal', { to: userId, signal, from: callerId });
  });

  peer.on('stream', (stream) => {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.className = 'participant-video';
    video.id = `video-${userId}`;
    const container = document.createElement('div');
    container.className = 'participant';
    container.appendChild(video);
    document.getElementById('participants').appendChild(container);
  });

  return peer;
}

// Handle signaling and peer connections
function setupRoom(roomId) {
  socket.emit('join-room', roomId, socket.id);

  socket.on('user-connected', (userId) => {
    if (userId !== socket.id) {
      const peer = createPeer(userId, socket.id);
      peers[userId] = peer;
    }
  });

  socket.on('user-disconnected', (userId) => {
    if (peers[userId]) {
      peers[userId].destroy();
      delete peers[userId];
      const videoElement = document.getElementById(`video-${userId}`);
      if (videoElement) videoElement.parentElement.remove();
    }
  });

  socket.on('signal', (data) => {
    if (!peers[data.from]) {
      const peer = createPeer(data.from, socket.id, false);
      peers[data.from] = peer;
    }
    peers[data.from].signal(data.signal);
  });

  socket.on('screen-sharing', (userId) => {
    document.getElementById('screen-share-btn').disabled = true;
  });

  socket.on('screen-sharing-stopped', () => {
    document.getElementById('screen-share-btn').disabled = false;
  });
}

// Start a meeting
function startMeeting(callback) {
  socket.emit('start-meeting', (roomId) => {
    callback(roomId);
  });
}

// Screen sharing toggle
async function toggleScreenShare(localVideo, roomId) {
  if (!isSharingScreen) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      socket.emit('start-screen-sharing', roomId, socket.id);
      isSharingScreen = true;
      document.getElementById('screen-share-icon').src = 'https://img.icons8.com/ios-filled/50/ffffff/stop-screen-sharing.png';
      document.getElementById('screen-share-icon').alt = 'Stop Sharing';

      // Replace video track in all peers
      Object.values(peers).forEach(peer => {
        const videoTrack = screenStream.getVideoTracks()[0];
        const sender = peer._pc.getSenders().find(s => s.track.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack);
      });

      localVideo.srcObject = screenStream;

      // Stop sharing if the stream ends (e.g., user stops sharing)
      screenStream.getVideoTracks()[0].onended = () => {
        stopScreenShare(localVideo, roomId);
      };
    } catch (err) {
      console.error('Error sharing screen:', err);
    }
  } else {
    stopScreenShare(localVideo, roomId);
  }
}

// Stop screen sharing
function stopScreenShare(localVideo, roomId) {
  socket.emit('stop-screen-sharing', roomId, socket.id);
  isSharingScreen = false;
  document.getElementById('screen-share-icon').src = 'https://img.icons8.com/ios-filled/50/ffffff/share-screen.png';
  document.getElementById('screen-share-icon').alt = 'Share Screen';

  // Revert to webcam
  const videoTrack = localStream.getVideoTracks()[0];
  Object.values(peers).forEach(peer => {
    const sender = peer._pc.getSenders().find(s => s.track.kind === 'video');
    if (sender) sender.replaceTrack(videoTrack);
  });

  localVideo.srcObject = localStream;
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
  }
}

// Start recording
function startRecording() {
  if (!isRecording && localStream) {
    mediaRecorder = new MediaRecorder(localStream);
    mediaRecorder.ondataavailable = (e) => recordedChunks.push(e.data);
    mediaRecorder.onstop = saveRecording;
    mediaRecorder.start();
    isRecording = true;
    document.getElementById('record-icon').src = 'https://img.icons8.com/ios-filled/50/ffffff/stop.png';
  }
}

// Stop recording
function stopRecording() {
  if (isRecording) {
    mediaRecorder.stop();
    isRecording = false;
    document.getElementById('record-icon').src = 'https://img.icons8.com/ios-filled/50/ffffff/record.png';
  }
}

// Save recording
function saveRecording() {
  if (recordedChunks.length > 0) {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const a = document.createElement('a');
    a.href = url;
    a.download = `recordings/recording-${timestamp}.webm`;
    a.click();
    recordedChunks = [];
  }
}