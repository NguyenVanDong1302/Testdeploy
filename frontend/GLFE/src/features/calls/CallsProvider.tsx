import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '../../components/Toast'
import { useAppStore } from '../../state/store'
import { useSocket } from '../../state/socket'
import { acceptCall, endCallSession, rejectCall, requestCallStart, sendCallMediaState, sendCallSignal } from './calls.socket'
import type {
  ActiveCallState,
  CallEndedPayload,
  CallEndReason,
  CallMediaStatePayload,
  CallSessionPayload,
  CallSignalPayload,
  CallsContextValue,
  StartCallInput,
} from './calls.types'
import { CallWindow } from './components/CallWindow'

const RTC_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
}

const CallsContext = createContext<CallsContextValue | null>(null)

function normalizeReason(reason?: string) {
  return String(reason || '').trim()
}

function getEndMessage(reason: string, peerUsername: string) {
  if (reason === 'busy') return `${peerUsername} đang bận`
  if (reason === 'rejected') return `${peerUsername} đã từ chối cuộc gọi`
  if (reason === 'unavailable') return `${peerUsername} hiện không khả dụng`
  if (reason === 'disconnected') return 'Kết nối cuộc gọi đã bị ngắt'
  return ''
}

function canUseWebRtc() {
  return typeof window !== 'undefined'
    && typeof window.RTCPeerConnection !== 'undefined'
    && typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia)
}

function stopStream(stream: MediaStream | null) {
  if (!stream) return
  for (const track of stream.getTracks()) track.stop()
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function getMediaErrorName(error: unknown) {
  if (error instanceof DOMException || error instanceof Error) return error.name
  if (typeof error === 'object' && error && 'name' in error) {
    return String((error as { name?: unknown }).name || '')
  }
  return ''
}

function getMediaErrorMessage(error: unknown) {
  if (error instanceof DOMException || error instanceof Error) return error.message
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message || '')
  }
  return ''
}

function isMissingVideoDeviceError(error: unknown) {
  const name = getMediaErrorName(error)
  const message = getMediaErrorMessage(error).toLowerCase()
  return name === 'NotFoundError'
    || name === 'DevicesNotFoundError'
    || name === 'OverconstrainedError'
    || message.includes('device not found')
    || message.includes('requested device not found')
}

function mapMediaRequestError(error: unknown, requestedVideo: boolean) {
  const name = getMediaErrorName(error)
  const message = getMediaErrorMessage(error)

  if (name === 'NotAllowedError') return 'Trình duyệt đang chặn quyền camera hoặc micro'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || isMissingVideoDeviceError(error)) {
    return requestedVideo ? 'Không tìm thấy camera hoặc micro khả dụng' : 'Không tìm thấy micro khả dụng'
  }
  if (name === 'NotReadableError') return 'Thiết bị camera hoặc micro đang được ứng dụng khác sử dụng'
  if (name === 'OverconstrainedError') return 'Không tìm thấy camera phù hợp'
  if (message) return message
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Trình duyệt đang chặn quyền camera hoặc micro'
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return requestedVideo ? 'Không tìm thấy camera hoặc micro khả dụng' : 'Không tìm thấy micro khả dụng'
    }
    if (error.name === 'NotReadableError') return 'Thiết bị camera hoặc micro đang được ứng dụng khác sử dụng'
    if (error.name === 'OverconstrainedError') return 'Không tìm thấy camera phù hợp'
  }
  return requestedVideo ? 'Không thể truy cập camera hoặc micro' : 'Không thể truy cập micro'
}

async function requestPreferredMediaStream(preferVideo: boolean) {
  if (!preferVideo) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    return { stream, videoEnabled: false, usedVideoFallback: false }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { facingMode: 'user' },
    })

    return {
      stream,
      videoEnabled: stream.getVideoTracks().length > 0,
      usedVideoFallback: false,
    }
  } catch (error) {
    if (isMissingVideoDeviceError(error)) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      return { stream, videoEnabled: false, usedVideoFallback: true }
    }
    throw new Error(mapMediaRequestError(error, true))
  }
}

async function requestVideoTrack() {
  try {
    const cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
    })
    const videoTrack = cameraStream.getVideoTracks()[0]
    if (!videoTrack) throw new Error('Không tìm thấy camera khả dụng')
    return videoTrack
  } catch (error) {
    throw new Error(mapMediaRequestError(error, true))
  }
}

export function CallsProvider({ children }: { children: React.ReactNode }) {
  const { socket } = useSocket()
  const toast = useToast()
  const { state } = useAppStore()
  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null)
  const activeCallRef = useRef<ActiveCallState | null>(null)
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const videoSenderRef = useRef<RTCRtpSender | null>(null)
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([])

  const setCallState = useCallback((next: ActiveCallState | null | ((current: ActiveCallState | null) => ActiveCallState | null)) => {
    setActiveCall((current) => {
      const value = typeof next === 'function' ? next(current) : next
      activeCallRef.current = value
      return value
    })
  }, [])

  const updateCallState = useCallback((patch: Partial<ActiveCallState> | ((current: ActiveCallState) => Partial<ActiveCallState> | null)) => {
    setCallState((current) => {
      if (!current) return current
      const nextPatch = typeof patch === 'function' ? patch(current) : patch
      if (!nextPatch) return current
      return { ...current, ...nextPatch }
    })
  }, [setCallState])

  const resetConnection = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.ontrack = null
      peerConnectionRef.current.onicecandidate = null
      peerConnectionRef.current.onconnectionstatechange = null
      peerConnectionRef.current.close()
    }
    peerConnectionRef.current = null
    videoSenderRef.current = null
    pendingCandidatesRef.current = []
  }, [])

  const clearCall = useCallback((message = '') => {
    resetConnection()
    stopStream(localStreamRef.current)
    stopStream(remoteStreamRef.current)
    localStreamRef.current = null
    remoteStreamRef.current = null
    setCallState(null)
    if (message) toast.push(message)
  }, [resetConnection, setCallState, toast])

  const flushPendingCandidates = useCallback(async (pc: RTCPeerConnection) => {
    const queued = [...pendingCandidatesRef.current]
    pendingCandidatesRef.current = []
    for (const candidate of queued) {
      await pc.addIceCandidate(candidate)
    }
  }, [])

  const emitCurrentMediaState = useCallback((overrides?: Partial<CallMediaStatePayload>) => {
    const call = activeCallRef.current
    if (!call?.sessionId) return
    sendCallMediaState(socket, {
      sessionId: call.sessionId,
      videoEnabled: overrides?.videoEnabled ?? call.localVideoEnabled,
      audioEnabled: overrides?.audioEnabled ?? call.localAudioEnabled,
    })
  }, [socket])

  const ensurePeerConnection = useCallback(async () => {
    const currentCall = activeCallRef.current
    if (!currentCall) throw new Error('Không có cuộc gọi đang hoạt động')
    if (peerConnectionRef.current) return peerConnectionRef.current

    const pc = new RTCPeerConnection(RTC_CONFIGURATION)
    const remoteStream = remoteStreamRef.current || new MediaStream()
    remoteStreamRef.current = remoteStream

    pc.ontrack = (event) => {
      const stream = remoteStreamRef.current || new MediaStream()
      const incomingTracks = event.streams[0]?.getTracks().length ? event.streams[0].getTracks() : [event.track]

      for (const track of incomingTracks) {
        if (!stream.getTracks().some((existing) => existing.id === track.id)) {
          stream.addTrack(track)
        }
        track.onended = () => {
          stream.removeTrack(track)
          updateCallState({
            remoteStream: stream,
            remoteVideoEnabled: stream.getVideoTracks().some((item) => item.readyState === 'live' && item.enabled),
            remoteAudioEnabled: stream.getAudioTracks().some((item) => item.readyState === 'live' && item.enabled),
          })
        }
      }

      updateCallState((call) => ({
        remoteStream: stream,
        remoteVideoEnabled: stream.getVideoTracks().some((item) => item.readyState === 'live' && item.enabled),
        remoteAudioEnabled: stream.getAudioTracks().some((item) => item.readyState === 'live' && item.enabled) || call.remoteAudioEnabled,
      }))
    }

    pc.onicecandidate = (event) => {
      const sessionId = activeCallRef.current?.sessionId
      if (!sessionId || !event.candidate) return
      sendCallSignal(socket, {
        sessionId,
        candidate: event.candidate.toJSON(),
      })
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        updateCallState({ phase: 'in-call' })
        return
      }

      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        const peerName = activeCallRef.current?.peer.username || 'Người dùng'
        clearCall(`Cuộc gọi với ${peerName} đã kết thúc`)
      }
    }

    const localStream = localStreamRef.current
    if (localStream) {
      for (const audioTrack of localStream.getAudioTracks()) {
        pc.addTrack(audioTrack, localStream)
      }
    }

    const videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' })
    videoSenderRef.current = videoTransceiver.sender
    const currentVideoTrack = localStreamRef.current?.getVideoTracks()[0]
    if (currentVideoTrack) {
      await videoTransceiver.sender.replaceTrack(currentVideoTrack)
    }

    peerConnectionRef.current = pc
    return pc
  }, [clearCall, socket, updateCallState])

  const createOffer = useCallback(async () => {
    const currentCall = activeCallRef.current
    if (!currentCall?.sessionId) return

    const pc = await ensurePeerConnection()
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    sendCallSignal(socket, {
      sessionId: currentCall.sessionId,
      description: pc.localDescription?.toJSON() || offer,
    })
  }, [ensurePeerConnection, socket])

  const handleSignal = useCallback(async (payload: CallSignalPayload) => {
    const currentCall = activeCallRef.current
    if (!currentCall || payload.sessionId !== currentCall.sessionId) return

    const pc = await ensurePeerConnection()

    if (payload.description) {
      await pc.setRemoteDescription(payload.description)
      await flushPendingCandidates(pc)

      if (payload.description.type === 'offer') {
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        sendCallSignal(socket, {
          sessionId: currentCall.sessionId,
          description: pc.localDescription?.toJSON() || answer,
        })
      }
      return
    }

    if (payload.candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(payload.candidate)
      else pendingCandidatesRef.current.push(payload.candidate)
    }
  }, [ensurePeerConnection, flushPendingCandidates, socket])

  const startCall = useCallback(async ({ conversationId, peer, mode }: StartCallInput) => {
    if (!canUseWebRtc()) throw new Error('Trình duyệt hiện tại không hỗ trợ gọi realtime')
    if (!socket) throw new Error('Realtime chưa kết nối')
    if (activeCallRef.current) throw new Error('Bạn đang trong một cuộc gọi khác')

    remoteStreamRef.current = new MediaStream()

    try {
      const mediaRequest = await requestPreferredMediaStream(mode === 'video')
      const localStream = mediaRequest.stream
      localStreamRef.current = localStream

      setCallState({
        sessionId: '',
        conversationId,
        mode,
        phase: 'outgoing',
        direction: 'outgoing',
        peer,
        localStream,
        remoteStream: remoteStreamRef.current,
        localVideoEnabled: mediaRequest.videoEnabled,
        localAudioEnabled: true,
        remoteVideoEnabled: mode === 'video',
        remoteAudioEnabled: true,
        isMinimized: false,
        createdAt: new Date().toISOString(),
        answeredAt: null,
      })

      if (mediaRequest.usedVideoFallback) {
        toast.push('Không tìm thấy camera, cuộc gọi sẽ bắt đầu với micro')
      }

      const result = await requestCallStart(socket, {
        conversationId,
        targetUserId: peer.id,
        mode,
      })

      setCallState((current) => {
        if (!current) return current
        return {
          ...current,
          sessionId: result.session.sessionId,
          createdAt: result.session.createdAt,
          peer: result.session.callee,
        }
      })
    } catch (error) {
      clearCall()
      throw error
    }
  }, [clearCall, setCallState, socket, toast])

  const acceptIncomingCall = useCallback(async () => {
    const currentCall = activeCallRef.current
    if (!currentCall || currentCall.phase !== 'incoming') return
    if (!canUseWebRtc()) throw new Error('Trình duyệt hiện tại không hỗ trợ gọi realtime')

    try {
      const mediaRequest = await requestPreferredMediaStream(currentCall.mode === 'video')
      const localStream = mediaRequest.stream
      localStreamRef.current = localStream
      remoteStreamRef.current = new MediaStream()

      setCallState((current) => {
        if (!current) return current
        return {
          ...current,
          phase: 'connecting',
          localStream,
          remoteStream: remoteStreamRef.current,
          localVideoEnabled: mediaRequest.videoEnabled,
          localAudioEnabled: true,
          isMinimized: false,
        }
      })

      if (mediaRequest.usedVideoFallback) {
        toast.push('Không tìm thấy camera, cuộc gọi sẽ nhận với micro')
      }

      const result = await acceptCall(socket, currentCall.sessionId)
      setCallState((current) => {
        if (!current) return current
        return {
          ...current,
          answeredAt: result.session.answeredAt || null,
        }
      })

      await ensurePeerConnection()
      emitCurrentMediaState({
        videoEnabled: mediaRequest.videoEnabled,
        audioEnabled: true,
      })
    } catch (error) {
      const sessionId = activeCallRef.current?.sessionId
      if (sessionId) await rejectCall(socket, sessionId, 'failed').catch(() => {})
      clearCall(toErrorMessage(error, 'Không thể nhận cuộc gọi'))
      throw error
    }
  }, [clearCall, emitCurrentMediaState, ensurePeerConnection, setCallState, socket, toast])

  const declineIncomingCall = useCallback(async (reason: CallEndReason = 'rejected') => {
    const currentCall = activeCallRef.current
    if (!currentCall?.sessionId) return
    await rejectCall(socket, currentCall.sessionId, reason).catch(() => {})
    clearCall()
  }, [clearCall, socket])

  const endCall = useCallback(async (reason: CallEndReason = 'ended') => {
    const currentCall = activeCallRef.current
    if (!currentCall?.sessionId) {
      clearCall()
      return
    }
    await endCallSession(socket, currentCall.sessionId, reason).catch(() => {})
    clearCall()
  }, [clearCall, socket])

  const toggleLocalAudio = useCallback(() => {
    const currentCall = activeCallRef.current
    const localStream = localStreamRef.current
    if (!currentCall || !localStream) return
    const audioTrack = localStream.getAudioTracks()[0]
    if (!audioTrack) return

    audioTrack.enabled = !audioTrack.enabled
    updateCallState({
      localStream,
      localAudioEnabled: audioTrack.enabled,
    })

    sendCallMediaState(socket, {
      sessionId: currentCall.sessionId,
      videoEnabled: currentCall.localVideoEnabled,
      audioEnabled: audioTrack.enabled,
    })
  }, [socket, updateCallState])

  const toggleLocalVideo = useCallback(async () => {
    const currentCall = activeCallRef.current
    const localStream = localStreamRef.current
    if (!currentCall || !localStream) return

    let videoTrack = localStream.getVideoTracks()[0]

    if (!videoTrack) {
      videoTrack = await requestVideoTrack()
      localStream.addTrack(videoTrack)
      if (videoSenderRef.current) {
        await videoSenderRef.current.replaceTrack(videoTrack)
      }
    } else {
      videoTrack.enabled = !videoTrack.enabled
    }

    updateCallState({
      localStream,
      localVideoEnabled: videoTrack.enabled,
    })

    sendCallMediaState(socket, {
      sessionId: currentCall.sessionId,
      videoEnabled: videoTrack.enabled,
      audioEnabled: activeCallRef.current?.localAudioEnabled ?? true,
    })
  }, [socket, updateCallState])

  const minimizeCallWindow = useCallback(() => {
    updateCallState({ isMinimized: true })
  }, [updateCallState])

  const expandCallWindow = useCallback(() => {
    updateCallState({ isMinimized: false })
  }, [updateCallState])

  useEffect(() => {
    if (!socket) return undefined

    const onIncoming = (session: CallSessionPayload) => {
      if (session.caller.username === state.username) return
      if (activeCallRef.current) {
        void rejectCall(socket, session.sessionId, 'busy').catch(() => {})
        return
      }

      remoteStreamRef.current = new MediaStream()
      setCallState({
        sessionId: session.sessionId,
        conversationId: session.conversationId,
        mode: session.mode,
        phase: 'incoming',
        direction: 'incoming',
        peer: session.caller,
        localStream: null,
        remoteStream: remoteStreamRef.current,
        localVideoEnabled: false,
        localAudioEnabled: true,
        remoteVideoEnabled: session.mode === 'video',
        remoteAudioEnabled: true,
        isMinimized: false,
        createdAt: session.createdAt,
        answeredAt: session.answeredAt || null,
      })
      toast.push(`${session.caller.username} đang gọi cho bạn`)
    }

    const onAccepted = (session: CallSessionPayload) => {
      if (activeCallRef.current?.sessionId !== session.sessionId) return
      setCallState((current) => {
        if (!current) return current
        return {
          ...current,
          phase: 'connecting',
          answeredAt: session.answeredAt || null,
          isMinimized: false,
        }
      })

      emitCurrentMediaState()
      void createOffer().catch((error) => {
        clearCall(toErrorMessage(error, 'Không thể thiết lập cuộc gọi'))
      })
    }

    const onSignal = (payload: CallSignalPayload) => {
      if (activeCallRef.current?.sessionId !== payload.sessionId) return
      void handleSignal(payload).catch((error) => {
        clearCall(toErrorMessage(error, 'Kết nối cuộc gọi thất bại'))
      })
    }

    const onMediaState = (payload: CallMediaStatePayload) => {
      if (activeCallRef.current?.sessionId !== payload.sessionId) return
      if (payload.userId !== activeCallRef.current?.peer.id) return
      updateCallState({
        remoteVideoEnabled: payload.videoEnabled,
        remoteAudioEnabled: typeof payload.audioEnabled === 'boolean' ? payload.audioEnabled : true,
      })
    }

    const onEnded = (payload: CallEndedPayload) => {
      if (activeCallRef.current?.sessionId !== payload.sessionId) return
      const message = payload.reason === 'answered_elsewhere'
        ? ''
        : getEndMessage(normalizeReason(payload.reason), activeCallRef.current?.peer.username || 'Người dùng')
      clearCall(message)
    }

    socket.on('call:incoming', onIncoming)
    socket.on('call:accepted', onAccepted)
    socket.on('call:signal', onSignal)
    socket.on('call:media-state', onMediaState)
    socket.on('call:ended', onEnded)

    return () => {
      socket.off('call:incoming', onIncoming)
      socket.off('call:accepted', onAccepted)
      socket.off('call:signal', onSignal)
      socket.off('call:media-state', onMediaState)
      socket.off('call:ended', onEnded)
    }
  }, [clearCall, createOffer, emitCurrentMediaState, handleSignal, setCallState, socket, state.username, toast, updateCallState])

  useEffect(() => {
    if (socket) return
    if (!activeCallRef.current) return
    clearCall('Realtime đã ngắt, cuộc gọi đã kết thúc')
  }, [clearCall, socket])

  useEffect(() => () => {
    resetConnection()
    stopStream(localStreamRef.current)
    stopStream(remoteStreamRef.current)
  }, [resetConnection])

  const value = useMemo<CallsContextValue>(() => ({
    activeCall,
    startCall,
    acceptIncomingCall,
    declineIncomingCall,
    endCall,
    toggleLocalVideo,
    toggleLocalAudio,
    minimizeCallWindow,
    expandCallWindow,
  }), [acceptIncomingCall, activeCall, declineIncomingCall, endCall, expandCallWindow, minimizeCallWindow, startCall, toggleLocalAudio, toggleLocalVideo])

  return (
    <CallsContext.Provider value={value}>
      {children}
      {activeCall ? (
        <CallWindow
          call={activeCall}
          onAccept={() => { void acceptIncomingCall() }}
          onDecline={() => { void declineIncomingCall() }}
          onEnd={() => { void endCall() }}
          onToggleVideo={() => { void toggleLocalVideo().catch((error) => toast.push(toErrorMessage(error, 'Không thể cập nhật camera'))) }}
          onToggleAudio={toggleLocalAudio}
          onMinimize={minimizeCallWindow}
          onExpand={expandCallWindow}
        />
      ) : null}
    </CallsContext.Provider>
  )
}

export function useCalls() {
  const context = useContext(CallsContext)
  if (!context) throw new Error('useCalls must be used within <CallsProvider>')
  return context
}
