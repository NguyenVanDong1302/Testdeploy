import type { Socket } from 'socket.io-client'
import type { CallEndReason, CallMediaStatePayload, CallMode, CallSessionPayload, CallSignalPayload } from './calls.types'

type AckSuccess<T> = { ok: true; data?: T }
type AckFailure = { ok: false; message?: string; code?: string }
type AckResult<T> = AckSuccess<T> | AckFailure

function getAckErrorMessage<T>(result: AckResult<T>, fallback: string) {
  return result.ok ? '' : (result.message || fallback)
}

function emitWithAck<T>(socket: Socket | null, event: string, payload: Record<string, unknown>, fallback: string) {
  return new Promise<T>((resolve, reject) => {
    if (!socket) {
      reject(new Error('Realtime chưa kết nối'))
      return
    }

    socket.emit(event, payload, (ack: AckResult<T>) => {
      if (ack?.ok) {
        resolve((ack.data || {}) as T)
        return
      }
      reject(new Error(getAckErrorMessage(ack, fallback)))
    })
  })
}

export function requestCallStart(
  socket: Socket | null,
  payload: { conversationId: string; targetUserId: string; mode: CallMode },
) {
  return emitWithAck<{ session: CallSessionPayload }>(socket, 'call:start', payload, 'Không thể bắt đầu cuộc gọi')
}

export function acceptCall(socket: Socket | null, sessionId: string) {
  return emitWithAck<{ session: CallSessionPayload }>(socket, 'call:accept', { sessionId }, 'Không thể nhận cuộc gọi')
}

export function rejectCall(socket: Socket | null, sessionId: string, reason: CallEndReason = 'rejected') {
  return emitWithAck<Record<string, never>>(socket, 'call:reject', { sessionId, reason }, 'Không thể từ chối cuộc gọi')
}

export function endCallSession(socket: Socket | null, sessionId: string, reason: CallEndReason = 'ended') {
  return emitWithAck<Record<string, never>>(socket, 'call:end', { sessionId, reason }, 'Không thể kết thúc cuộc gọi')
}

export function sendCallSignal(socket: Socket | null, payload: Omit<CallSignalPayload, 'fromUserId'>) {
  if (!socket) return
  socket.emit('call:signal', payload)
}

export function sendCallMediaState(socket: Socket | null, payload: CallMediaStatePayload) {
  if (!socket) return
  socket.emit('call:media-state', payload)
}
