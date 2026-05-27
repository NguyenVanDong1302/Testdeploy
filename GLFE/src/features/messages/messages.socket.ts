import type { Socket } from 'socket.io-client'

export function joinConversation(socket: Socket | null, conversationId: string) {
  socket?.emit('conversation:join', { conversationId })
}

export function leaveConversation(socket: Socket | null, conversationId: string) {
  socket?.emit('conversation:leave', { conversationId })
}

export function sendRealtimeMessage(
  socket: Socket | null,
  conversationId: string,
  payload: { text?: string; replyToMessageId?: string | null },
) {
  return new Promise((resolve) => {
    if (!socket) {
      resolve({ ok: false })
      return
    }

    socket.emit('message:send', { conversationId, ...payload }, (ack: unknown) => {
      resolve(ack)
    })
  })
}

export function markConversationReadRealtime(socket: Socket | null, conversationId: string) {
  socket?.emit('message:read', { conversationId })
}
