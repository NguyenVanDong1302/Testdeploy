export type CallPeer = {
  id: string
  username: string
  avatarUrl?: string
  bio?: string
}

export type CallMode = 'audio' | 'video'
export type CallPhase = 'incoming' | 'outgoing' | 'connecting' | 'in-call'
export type CallDirection = 'incoming' | 'outgoing'
export type CallEndReason =
  | 'ended'
  | 'rejected'
  | 'busy'
  | 'failed'
  | 'cancelled'
  | 'unavailable'
  | 'disconnected'
  | 'answered_elsewhere'

export type CallSessionPayload = {
  sessionId: string
  conversationId: string
  mode: CallMode
  status: 'ringing' | 'accepted'
  createdAt: string
  answeredAt?: string | null
  caller: CallPeer
  callee: CallPeer
}

export type CallSignalPayload = {
  sessionId: string
  fromUserId: string
  description?: RTCSessionDescriptionInit | null
  candidate?: RTCIceCandidateInit | null
}

export type CallMediaStatePayload = {
  sessionId: string
  userId?: string
  videoEnabled: boolean
  audioEnabled?: boolean
}

export type CallEndedPayload = {
  sessionId: string
  conversationId: string
  reason: CallEndReason | string
  endedBy?: string
  endedAt?: string
}

export type ActiveCallState = {
  sessionId: string
  conversationId: string
  mode: CallMode
  phase: CallPhase
  direction: CallDirection
  peer: CallPeer
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  localVideoEnabled: boolean
  localAudioEnabled: boolean
  remoteVideoEnabled: boolean
  remoteAudioEnabled: boolean
  isMinimized: boolean
  createdAt: string
  answeredAt?: string | null
}

export type StartCallInput = {
  conversationId: string
  peer: CallPeer
  mode: CallMode
}

export type CallsContextValue = {
  activeCall: ActiveCallState | null
  startCall: (input: StartCallInput) => Promise<void>
  acceptIncomingCall: () => Promise<void>
  declineIncomingCall: (reason?: CallEndReason) => Promise<void>
  endCall: (reason?: CallEndReason) => Promise<void>
  toggleLocalVideo: () => Promise<void>
  toggleLocalAudio: () => void
  minimizeCallWindow: () => void
  expandCallWindow: () => void
}
