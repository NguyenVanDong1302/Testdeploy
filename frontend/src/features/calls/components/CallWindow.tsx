import { createPortal } from 'react-dom'
import { useEffect, useRef } from 'react'
import { getAvatarUrl } from '../../../lib/avatar'
import type { ActiveCallState } from '../calls.types'
import styles from './CallWindow.module.css'

function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

function VideoStream({
  stream,
  muted,
  className,
}: {
  stream: MediaStream | null
  muted: boolean
  className: string
}) {
  const ref = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (!ref.current) return
    ref.current.srcObject = stream
  }, [stream])

  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />
}

function PhoneIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.2 3.6h3.1l1.1 4.2-2 1.8a15.5 15.5 0 0 0 5 5l1.8-2 4.2 1.1v3.1a1.8 1.8 0 0 1-1.8 1.8A15.8 15.8 0 0 1 3.6 5.4 1.8 1.8 0 0 1 5.4 3.6Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  )
}

function VideoIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.8 7.2A2.4 2.4 0 0 1 7.2 4.8h7.6a2.4 2.4 0 0 1 2.4 2.4v9.6a2.4 2.4 0 0 1-2.4 2.4H7.2a2.4 2.4 0 0 1-2.4-2.4Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="m17.2 10 3-2v8l-3-2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  )
}

function MicrophoneIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.8a2.8 2.8 0 0 1 2.8 2.8v4.8a2.8 2.8 0 1 1-5.6 0V6.6A2.8 2.8 0 0 1 12 3.8Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M6.8 11.6a5.2 5.2 0 1 0 10.4 0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M12 16.8v3.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  )
}

function CollapseIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 15h8M8 11h8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 15h8M8 11h8M8 7h8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  )
}

function callTitle(call: ActiveCallState) {
  if (call.phase === 'incoming') return call.mode === 'video' ? 'Cuộc gọi video đến' : 'Cuộc gọi đến'
  if (call.phase === 'outgoing') return call.mode === 'video' ? 'Đang gọi video' : 'Đang gọi'
  if (call.phase === 'connecting') return 'Đang kết nối'
  return call.mode === 'video' ? 'Đang gọi video' : 'Đang gọi thoại'
}

function callSubtitle(call: ActiveCallState) {
  if (call.phase === 'incoming') return 'Nhấn nhận để tham gia cuộc gọi'
  if (call.phase === 'outgoing') return 'Đang chờ người kia trả lời'
  if (call.phase === 'connecting') return 'Đang thiết lập kết nối media'
  return call.remoteVideoEnabled ? 'Camera đang bật' : 'Video hiện đang tắt'
}

export function CallWindow({
  call,
  onAccept,
  onDecline,
  onEnd,
  onToggleVideo,
  onToggleAudio,
  onMinimize,
  onExpand,
}: {
  call: ActiveCallState
  onAccept: () => void
  onDecline: () => void
  onEnd: () => void
  onToggleVideo: () => void
  onToggleAudio: () => void
  onMinimize: () => void
  onExpand: () => void
}) {
  if (typeof document === 'undefined') return null

  const remoteHasVideo = Boolean(call.remoteVideoEnabled && call.remoteStream && call.remoteStream.getVideoTracks().length)
  const localHasVideo = Boolean(call.localVideoEnabled && call.localStream && call.localStream.getVideoTracks().length)
  const avatarUrl = getAvatarUrl(call.peer)

  const content = call.isMinimized ? (
    <div className={cx(styles.window, styles.windowMinimized)}>
      <div className={styles.miniBar}>
        <img className={styles.miniAvatar} src={avatarUrl} alt={call.peer.username} />
        <div className={styles.miniMeta}>
          <div className={styles.miniTitle}>{call.peer.username}</div>
          <div className={styles.miniSubtitle}>{callTitle(call)}</div>
        </div>
        <div className={styles.miniControls}>
          <button className={styles.windowAction} type="button" onClick={onExpand} aria-label="Mở rộng cửa sổ cuộc gọi">
            <ExpandIcon />
          </button>
          <button className={cx(styles.control, styles.controlDanger)} type="button" onClick={onEnd} aria-label="Kết thúc cuộc gọi">
            <PhoneIcon />
          </button>
        </div>
      </div>
    </div>
  ) : (
    <div className={styles.window}>
      <div className={styles.header}>
        <div className={styles.meta}>
          <div className={styles.eyebrow}>{call.mode === 'video' ? 'Cuộc gọi video' : 'Cuộc gọi thoại'}</div>
          <div className={styles.title}>{callTitle(call)}</div>
          <div className={styles.subtitle}>{callSubtitle(call)}</div>
        </div>
        {call.phase !== 'incoming' ? (
          <button className={styles.windowAction} type="button" onClick={onMinimize} aria-label="Thu nhỏ cửa sổ cuộc gọi">
            <CollapseIcon />
          </button>
        ) : null}
      </div>

      <div className={styles.body}>
        <div className={styles.stage}>
          {remoteHasVideo ? (
            <VideoStream stream={call.remoteStream} muted={false} className={styles.remoteVideo} />
          ) : (
            <div className={styles.emptyStage}>
              <img className={styles.avatar} src={avatarUrl} alt={call.peer.username} />
              <div className={styles.callState}>
                <div className={styles.callName}>{call.peer.username}</div>
                <div className={styles.callHint}>{call.peer.bio || 'Người dùng T'}</div>
              </div>
            </div>
          )}

          {localHasVideo ? (
            <div className={styles.localPreview}>
              <VideoStream stream={call.localStream} muted className={styles.localVideo} />
              <div className={styles.localBadge}>Bạn</div>
            </div>
          ) : null}
        </div>

        {call.phase === 'incoming' ? (
          <div className={styles.incomingActions}>
            <button className={cx(styles.incomingAction, styles.decline)} type="button" onClick={onDecline}>Từ chối</button>
            <button className={cx(styles.incomingAction, styles.accept)} type="button" onClick={onAccept}>Nhận cuộc gọi</button>
          </div>
        ) : (
          <div className={styles.controls}>
            <button
              className={cx(styles.control, call.localAudioEnabled && styles.controlActive)}
              type="button"
              onClick={onToggleAudio}
              aria-label={call.localAudioEnabled ? 'Tắt micro' : 'Bật micro'}
            >
              <MicrophoneIcon />
            </button>
            <button
              className={cx(styles.control, call.localVideoEnabled && styles.controlActive)}
              type="button"
              onClick={onToggleVideo}
              aria-label={call.localVideoEnabled ? 'Tắt camera' : 'Bật camera'}
            >
              <VideoIcon />
            </button>
            <button className={cx(styles.control, styles.controlDanger)} type="button" onClick={onEnd} aria-label="Kết thúc cuộc gọi">
              <PhoneIcon />
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
