import {
  ChangeEvent,
  DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './CreatePostPage.module.css'
import desktopStyles from './CreatePostPage.desktop.module.css'
import tabletStyles from './CreatePostPage.tablet.module.css'
import mobileStyles from './CreatePostPage.mobile.module.css'
import { useAuth } from '../features/auth/AuthProvider'
import { useAppStore } from '../state/store'
import { createPostApi } from '../features/posts/posts.api'
import { combineResponsiveStyles } from '../lib/combineResponsiveStyles'

type ShareTarget = 'threads' | 'facebook'
type MediaItem = {
  id: string
  file: File
  type: 'image' | 'video'
  previewUrl: string
  aspectRatio?: number
  orientation?: 'square' | 'portrait' | 'landscape'
}



type UtilityKey = 'accessibility' | 'quality'
type AdvancedKey = 'hideLikes' | 'disableComments'

const MAX_CAPTION = 2200
const responsiveStyles = combineResponsiveStyles(desktopStyles, tabletStyles, mobileStyles)

function buildMediaItems(files: FileList | File[]) {
  return Array.from(files)
    .filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'))
    .map<MediaItem>((file) => ({
      id: `${file.name}-${file.lastModified}-${Math.random().toString(16).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      type: file.type.startsWith('video/') ? 'video' : 'image',
    }))
}

export default function CreatePostPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { state } = useAppStore()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const mediaItemsRef = useRef<MediaItem[]>([])

  const [step, setStep] = useState<'upload' | 'compose'>('upload')
  const [isDragging, setIsDragging] = useState(false)
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [caption, setCaption] = useState('')
  const [location, setLocation] = useState('')
  const [collaborators, setCollaborators] = useState('')
  const [shareTargets, setShareTargets] = useState<Record<ShareTarget, boolean>>({
    threads: false,
    facebook: false,
  })
  const [utilityOpen, setUtilityOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [utilityOptions, setUtilityOptions] = useState<Record<UtilityKey, boolean>>({
    accessibility: false,
    quality: true,
  })
  const [advancedOptions, setAdvancedOptions] = useState<Record<AdvancedKey, boolean>>({
    hideLikes: false,
    disableComments: false,
  })
  const [altText, setAltText] = useState('')
  const [audience, setAudience] = useState<'public' | 'friends'>('public')
  const [status, setStatus] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const enrichVideoMetadata = useCallback(async (items: MediaItem[]) => {
    const videoItems = items.filter((item) => item.type === 'video')
    if (!videoItems.length) return

    const updates = await Promise.all(
      videoItems.map(async (item) => {
        const meta = await getVideoMetadata(item.previewUrl)
        return {
          id: item.id,
          ...meta,
        }
      })
    )

    setMediaItems((prev) =>
      prev.map((item) => {
        const found = updates.find((update) => update.id === item.id)
        return found
          ? {
            ...item,
            aspectRatio: found.aspectRatio,
            orientation: found.orientation,
          }
          : item
      })
    )
  }, [])

  const activeItem = mediaItems[activeIndex] ?? null
  const goToPrevMedia = useCallback(() => {
    setActiveIndex((prev) => {
      if (mediaItems.length <= 1) return prev
      return prev === 0 ? mediaItems.length - 1 : prev - 1
    })
  }, [mediaItems.length])

  const goToNextMedia = useCallback(() => {
    setActiveIndex((prev) => {
      if (mediaItems.length <= 1) return prev
      return prev === mediaItems.length - 1 ? 0 : prev + 1
    })
  }, [mediaItems.length])
  const username = user?.displayName || user?.email?.split('@')[0] || 'your_account'
  const avatar = user?.photoURL || ''

  const getVideoMetadata = (
    url: string
  ): Promise<{ aspectRatio: number; orientation: 'square' | 'portrait' | 'landscape' }> => {
    return new Promise((resolve) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.muted = true
      video.playsInline = true

      const cleanup = () => {
        video.removeAttribute('src')
        video.load()
      }

      video.onloadedmetadata = () => {
        const width = video.videoWidth || 1
        const height = video.videoHeight || 1
        const ratio = width / height

        let orientation: 'square' | 'portrait' | 'landscape' = 'landscape'
        if (Math.abs(ratio - 1) < 0.05) orientation = 'square'
        else if (ratio < 1) orientation = 'portrait'
        else orientation = 'landscape'

        cleanup()
        resolve({
          aspectRatio: ratio,
          orientation,
        })
      }

      video.onerror = () => {
        cleanup()
        resolve({
          aspectRatio: 1,
          orientation: 'square',
        })
      }

      video.src = url
    })
  }


  useEffect(() => {
    mediaItemsRef.current = mediaItems
  }, [mediaItems])

  useEffect(() => {
    return () => {
      mediaItemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
    }
  }, [])

  useEffect(() => {
    if (step !== 'compose' || mediaItems.length <= 1) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') goToPrevMedia()
      if (event.key === 'ArrowRight') goToNextMedia()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goToNextMedia, goToPrevMedia, mediaItems.length, step])

  const remainingChars = MAX_CAPTION - caption.length
  const canProceed = mediaItems.length > 0 || caption.trim().length > 0

  const handleFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return

    const newItems = buildMediaItems(files)
    if (!newItems.length) {
      setStatus('Chỉ hỗ trợ ảnh hoặc video.')
      event.target.value = ''
      return
    }

    setMediaItems((prev) => {
      const next = [...prev, ...newItems]
      if (prev.length === 0) {
        setActiveIndex(0)
      }
      return next
    })

    setStep('compose')
    setStatus(`${newItems.length} tệp đã được thêm.`)
    void enrichVideoMetadata(newItems)
    event.target.value = ''
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    if (!event.dataTransfer.files?.length) return

    const newItems = buildMediaItems(event.dataTransfer.files)
    if (!newItems.length) {
      setStatus('Chỉ hỗ trợ ảnh hoặc video.')
      return
    }

    setMediaItems((prev) => {
      const next = [...prev, ...newItems]
      if (prev.length === 0) {
        setActiveIndex(0)
      }
      return next
    })

    setStep('compose')
    setStatus(`Đã tải lên ${newItems.length} tệp.`)
    void enrichVideoMetadata(newItems)
  }

  const removeMedia = (id: string) => {
    setMediaItems((prev) => {
      const next = prev.filter((item) => item.id !== id)
      const removed = prev.find((item) => item.id === id)
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      const nextIndex = Math.max(0, Math.min(activeIndex, next.length - 1))
      setActiveIndex(nextIndex)
      if (next.length === 0) {
        setStep('upload')
        setStatus('Đã xóa toàn bộ tệp. Hãy chọn lại ảnh hoặc video.')
      }
      return next
    })
  }

  const appendEmoji = () => {
    if (caption.length >= MAX_CAPTION) return
    setCaption((prev) => `${prev}${prev ? ' ' : ''}✨`)
  }

  const payloadPreview = useMemo(
    () => ({
      mediaCount: mediaItems.length,
      files: mediaItems.map((item) => ({
        name: item.file.name,
        type: item.file.type,
        size: item.file.size,
      })),
      caption,
      location,
      collaborators: collaborators
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      shareTargets,
      utilityOptions,
      advancedOptions,
      audience,
      altText,
    }),
    [
      advancedOptions,
      altText,
      audience,
      caption,
      collaborators,
      location,
      mediaItems,
      shareTargets,
      utilityOptions,
    ],
  )

  const handleShare = async () => {
    const captionValue = caption.trim()
    if (!mediaItems.length && !captionValue) {
      setStatus('Bạn cần nhập nội dung hoặc chọn ít nhất một ảnh/video trước khi chia sẻ.')
      return
    }

    setIsSubmitting(true)
    setStatus('Đang đăng bài...')

    try {
      const res = await createPostApi({
        payload: {
          content: captionValue,
          visibility: audience,
          isAnonymous: false,
          allowComments: !advancedOptions.disableComments,
          hideLikeCount: advancedOptions.hideLikes,
          location: location.trim(),
          collaborators: collaborators
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
          altText: altText.trim(),
          files: mediaItems.map((item) => item.file),
        },
        token: state.token,
        username: state.username,
      })

      console.log('create-post-payload', payloadPreview)
      console.log('create-post-response', res)
      if (res?.data?.pendingModeration) {
        setStatus(res?.message || 'Bài viết đang được kiểm duyệt media. Hệ thống sẽ xử lý tối đa 5 phút.')
        return
      }
      if (res?.data?.autoRemoved) {
        setStatus(res?.message || 'Bài viết đã bị gỡ tự động do nội dung nhạy cảm và đã gửi admin xử lý.')
        return
      }
      setStatus(res?.message || 'Đăng bài thành công.')
      navigate('/')
    } catch (error: any) {
      setStatus(error?.message || 'Đăng bài thất bại.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={`${styles.page} ${responsiveStyles.page}`}>
      <div className={styles.scrim} onClick={() => navigate(-1)} />

      <section className={`${styles.modal} ${responsiveStyles.modal}`} aria-label="Tạo bài viết mới">
        <header className={`${styles.header} ${responsiveStyles.header}`}>
          <button className={styles.iconButton} type="button" onClick={() => (step === 'compose' ? setStep('upload') : navigate(-1))}>
            ←
          </button>
          <h1 className={`${styles.title} ${responsiveStyles.title}`}>Tạo bài viết mới</h1>
          <button
            className={`${styles.shareButton} ${!canProceed ? styles.shareButtonDisabled : ''}`}
            type="button"
            disabled={!canProceed || isSubmitting}
            onClick={step === 'upload' ? () => setStep('compose') : handleShare}
          >
            {step === 'upload' ? 'Tiếp' : isSubmitting ? 'Đang đăng...' : 'Chia sẻ'}
          </button>
        </header>

        {step === 'upload' && (
          <div className={`${styles.uploadStep} ${responsiveStyles.uploadStep}`}>
            <div
              className={`${styles.dropZone} ${responsiveStyles.dropZone} ${isDragging ? styles.dropZoneActive : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  fileInputRef.current?.click()
                }
              }}
            >
              <div className={styles.uploadIllustration}>
                <div className={styles.uploadIconFrame}>🖼️</div>
                <div className={styles.uploadIconFrame}>▶</div>
              </div>
              <p className={styles.uploadTitle}>Kéo ảnh và video vào đây</p>
              <button className={styles.primaryButton} type="button" onClick={(event) => {
                event.stopPropagation()
                fileInputRef.current?.click()
              }}>
                Chọn từ máy tính
              </button>
              <span className={styles.uploadHint}>Hỗ trợ nhiều ảnh hoặc video trong một bài viết.</span>
            </div>
          </div>
        )}

        {step === 'compose' && (
          <div className={`${styles.composeStep} ${responsiveStyles.composeStep}`}>
            <div className={`${styles.previewPane} ${responsiveStyles.previewPane}`}>
              {activeItem ? (
                <>
                  <div
                    className={[
                      styles.previewMediaFrame,
                      responsiveStyles.previewMediaFrame,
                      activeItem.type === 'video' && activeItem.orientation
                        ? styles[`previewMediaFrame${activeItem.orientation.charAt(0).toUpperCase() + activeItem.orientation.slice(1)}`]
                        : '',
                      activeItem.type === 'video' && activeItem.orientation
                        ? responsiveStyles[`previewMediaFrame${activeItem.orientation.charAt(0).toUpperCase() + activeItem.orientation.slice(1)}`]
                        : '',
                    ].join(' ')}
                  >
                    {activeItem.type === 'image' ? (
                      <img
                        className={`${styles.previewMedia} ${responsiveStyles.previewMedia}`}
                        src={activeItem.previewUrl}
                        alt={activeItem.file.name}
                        draggable={false}
                      />
                    ) : (
                      <video
                        className={[
                          styles.previewMedia,
                          responsiveStyles.previewMedia,
                          activeItem.orientation ? styles[`previewMedia${activeItem.orientation.charAt(0).toUpperCase() + activeItem.orientation.slice(1)}`] : '',
                          activeItem.orientation ? responsiveStyles[`previewMedia${activeItem.orientation.charAt(0).toUpperCase() + activeItem.orientation.slice(1)}`] : '',
                        ].join(' ')}
                        src={activeItem.previewUrl}
                        controls
                        playsInline
                        preload="metadata"
                      />
                    )}
                  </div>

                  {mediaItems.length > 1 && (
                    <>
                      <button
                        type="button"
                        className={`${styles.previewNavButton} ${styles.previewNavButtonLeft} ${responsiveStyles.previewNavButton} ${responsiveStyles.previewNavButtonLeft}`}
                        onClick={goToPrevMedia}
                        aria-label="Xem tệp trước"
                      >
                        ‹
                      </button>

                      <button
                        type="button"
                        className={`${styles.previewNavButton} ${styles.previewNavButtonRight} ${responsiveStyles.previewNavButton} ${responsiveStyles.previewNavButtonRight}`}
                        onClick={goToNextMedia}
                        aria-label="Xem tệp tiếp theo"
                      >
                        ›
                      </button>

                      <div className={styles.previewDots}>
                        {mediaItems.map((item, index) => (
                          <button
                            key={item.id}
                            type="button"
                            className={`${styles.previewDot} ${index === activeIndex ? styles.previewDotActive : ''}`}
                            onClick={() => setActiveIndex(index)}
                            aria-label={`Chuyển đến tệp ${index + 1}`}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className={styles.previewEmpty}>Chưa có nội dung xem trước</div>
              )}
            </div>

            <div className={`${styles.sidebarPane} ${responsiveStyles.sidebarPane}`}>
              <div className={styles.authorRow}>
                <div className={styles.authorInfo}>
                  {avatar ? (
                    <img className={styles.avatar} src={avatar} alt={username} />
                  ) : (
                    <div className={styles.avatarFallback}>{username.slice(0, 1).toUpperCase()}</div>
                  )}
                  <strong>{username}</strong>
                </div>
                <button className={styles.secondaryTinyButton} type="button" onClick={() => fileInputRef.current?.click()}>
                  Thêm tệp
                </button>
              </div>

              {mediaItems.length > 0 && (
                <div className={styles.thumbnailRow}>
                  {mediaItems.map((item, index) => (
                    <div
                      key={item.id}
                      className={`${styles.thumbCard} ${index === activeIndex ? styles.thumbCardActive : ''}`}
                    >
                      <button type="button" className={styles.thumbButton} onClick={() => setActiveIndex(index)}>
                        {item.type === 'image' ? (
                          <img src={item.previewUrl} alt={item.file.name} className={styles.thumbImage} />
                        ) : (
                          <div className={styles.thumbVideoWrap}>
                            <video
                              src={item.previewUrl}
                              className={styles.thumbImage}
                              muted
                              playsInline
                              preload="metadata"
                            />
                            <span className={styles.thumbVideoBadge}>▶</span>
                          </div>
                        )}
                      </button>
                      <button type="button" className={styles.thumbRemove} onClick={() => removeMedia(item.id)}>
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className={styles.captionBox}>
                <div className={styles.captionToolbar}>
                  <button type="button" className={styles.iconSmallButton} onClick={appendEmoji}>☺</button>
                  <span className={styles.counter}>{caption.length}/{MAX_CAPTION}</span>
                </div>
                <textarea
                  className={styles.textarea}
                  placeholder="Viết chú thích..."
                  value={caption}
                  maxLength={MAX_CAPTION}
                  onChange={(event) => setCaption(event.target.value)}
                />
                <div className={`${styles.counterNote} ${remainingChars < 120 ? styles.counterWarning : ''}`}>
                  Còn lại {remainingChars} ký tự
                </div>
              </div>

              <div className={styles.optionRow}>
                <input
                  className={styles.textInput}
                  placeholder="Thêm vị trí"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                />
                <span className={styles.rowIcon}>📍</span>
              </div>

              <div className={styles.optionRow}>
                <input
                  className={styles.textInput}
                  placeholder="Thêm cộng tác viên (cách nhau bởi dấu phẩy)"
                  value={collaborators}
                  onChange={(event) => setCollaborators(event.target.value)}
                />
                <span className={styles.rowIcon}>👥</span>
              </div>

              <div className={styles.shareSection}>
                <h2 className={styles.sectionTitle}>Chia sẻ lên</h2>

                <button className={styles.switchRow} type="button" onClick={() => setShareTargets((prev) => ({ ...prev, threads: !prev.threads }))}>
                  <div className={styles.switchInfo}>
                    <div className={styles.switchAvatar}>@</div>
                    <div>
                      <strong>{username}</strong>
                      <div className={styles.switchMeta}>Threads · Công khai</div>
                    </div>
                  </div>
                  <span className={`${styles.switch} ${shareTargets.threads ? styles.switchOn : ''}`}>
                    <span className={styles.switchKnob} />
                  </span>
                </button>

                <button className={styles.switchRow} type="button" onClick={() => setShareTargets((prev) => ({ ...prev, facebook: !prev.facebook }))}>
                  <div className={styles.switchInfo}>
                    <div className={styles.switchAvatarImage}>{avatar ? <img src={avatar} alt="avatar" /> : 'f'}</div>
                    <div>
                      <strong>{user?.displayName || 'Tài khoản Facebook'}</strong>
                      <div className={styles.switchMeta}>Facebook · {audience === 'public' ? 'Công khai' : 'Bạn bè'}</div>
                    </div>
                  </div>
                  <span className={`${styles.switch} ${shareTargets.facebook ? styles.switchOn : ''}`}>
                    <span className={styles.switchKnob} />
                  </span>
                </button>
              </div>

              <div className={styles.accordion}>
                <button className={styles.accordionHeader} type="button" onClick={() => setUtilityOpen((prev) => !prev)}>
                  <span>Trợ năng</span>
                  <span>{utilityOpen ? '▾' : '▸'}</span>
                </button>
                {utilityOpen && (
                  <div className={styles.accordionContent}>
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={utilityOptions.accessibility}
                        onChange={(event) => setUtilityOptions((prev) => ({ ...prev, accessibility: event.target.checked }))}
                      />
                      Tạo mô tả tự động cho ảnh
                    </label>
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={utilityOptions.quality}
                        onChange={(event) => setUtilityOptions((prev) => ({ ...prev, quality: event.target.checked }))}
                      />
                      Tải ảnh/video ở chất lượng cao
                    </label>
                    <textarea
                      className={styles.inlineTextarea}
                      placeholder="Văn bản thay thế cho người dùng trình đọc màn hình"
                      value={altText}
                      onChange={(event) => setAltText(event.target.value)}
                    />
                  </div>
                )}
              </div>

              <div className={styles.accordion}>
                <button className={styles.accordionHeader} type="button" onClick={() => setAdvancedOpen((prev) => !prev)}>
                  <span>Cài đặt nâng cao</span>
                  <span>{advancedOpen ? '▾' : '▸'}</span>
                </button>
                {advancedOpen && (
                  <div className={styles.accordionContent}>
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={advancedOptions.hideLikes}
                        onChange={(event) => setAdvancedOptions((prev) => ({ ...prev, hideLikes: event.target.checked }))}
                      />
                      Ẩn số lượt thích và lượt xem trên bài viết này
                    </label>
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={advancedOptions.disableComments}
                        onChange={(event) => setAdvancedOptions((prev) => ({ ...prev, disableComments: event.target.checked }))}
                      />
                      Tắt bình luận
                    </label>
                    <div className={styles.audiencePills}>
                      <button
                        type="button"
                        className={`${styles.audiencePill} ${audience === 'public' ? styles.audiencePillActive : ''}`}
                        onClick={() => setAudience('public')}
                      >
                        Công khai
                      </button>
                      <button
                        type="button"
                        className={`${styles.audiencePill} ${audience === 'friends' ? styles.audiencePillActive : ''}`}
                        onClick={() => setAudience('friends')}
                      >
                        Bạn bè
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {status && <div className={styles.statusBox} role="status" aria-live="polite">{status}</div>}
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          className={styles.hiddenInput}
          type="file"
          accept="image/*,video/*"
          multiple
          onChange={handleFilesSelected}
        />
      </section>
    </div>
  )
}
