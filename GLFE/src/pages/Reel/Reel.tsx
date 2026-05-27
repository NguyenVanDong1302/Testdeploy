import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import "./Reel.scss";
import "../../styles/reel-desktop.css";
import "../../styles/reel-tablet.css";
import "../../styles/reel-mobile.css";
import ReelComments, { type ReelComment } from "./comments/ReelComments";
import { resolveMediaUrl, useApi } from "../../lib/api";
import { getAvatarUrl } from "../../lib/avatar";
import type { Post } from "../../types";

type Reel = {
  id: string;
  postId: string;
  src: string;
  poster?: string;
  username: string;
  handle?: string;
  caption: string;
  likes: number;
  comments: number;
  avatarUrl: string;
  commentsList: ReelComment[];
  likedByMe: boolean;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function pickFirst<T>(...values: Array<T | null | undefined | "">): T | undefined {
  return values.find((v) => v !== undefined && v !== null && v !== "") as T | undefined;
}

function looksLikeVideoUrl(url?: string) {
  if (!url) return false;
  return /\.(mp4|webm|mov|m4v|avi|mkv)(\?.*)?$/i.test(url);
}

function isVideoMedia(post: Post, item: Record<string, unknown> | undefined) {
  const type = String(
    pickFirst(
      item?.type as string | undefined,
      item?.mediaType as string | undefined,
      item?.kind as string | undefined,
      item?.mimeType as string | undefined,
      (post as unknown as Record<string, unknown>).mediaType as string | undefined,
      (post as unknown as Record<string, unknown>).type as string | undefined,
    ) || "",
  ).toLowerCase();

  const url = String(
    pickFirst(
      item?.url as string | undefined,
      item?.mediaUrl as string | undefined,
      (post as unknown as Record<string, unknown>).videoUrl as string | undefined,
      (post as unknown as Record<string, unknown>).url as string | undefined,
    ) || "",
  );

  return (
    type === "video" ||
    type.startsWith("video/") ||
    Boolean((post as unknown as Record<string, unknown>).isReel) ||
    looksLikeVideoUrl(url)
  );
}

function toReel(post: Post): Reel | null {
  const media = Array.isArray(post.media) ? post.media : [];
  const first = (media[0] || {}) as Record<string, unknown>;
  const mediaCount = media.length;
  const shouldUseAsReel = mediaCount === 1 && isVideoMedia(post, first);
  if (!shouldUseAsReel) return null;

  const src = resolveMediaUrl(
    pickFirst(
      first.url as string | undefined,
      first.mediaUrl as string | undefined,
      (post as unknown as Record<string, unknown>).videoUrl as string | undefined,
      (post as unknown as Record<string, unknown>).url as string | undefined,
    ),
  );

  if (!src) return null;

  const poster = resolveMediaUrl(
    pickFirst(
      first.thumbnailUrl as string | undefined,
      first.poster as string | undefined,
      first.imageUrl as string | undefined,
      (post as unknown as Record<string, unknown>).thumbnailUrl as string | undefined,
      (post as unknown as Record<string, unknown>).poster as string | undefined,
    ),
  );

  const username =
    pickFirst(
      post.authorUsername,
      (post as unknown as Record<string, unknown>).username as string | undefined,
      (post as unknown as Record<string, unknown>).ownerUsername as string | undefined,
    ) || "user";

  return {
    id: post._id,
    postId: post._id,
    src,
    poster,
    username,
    handle: username,
    caption:
      pickFirst(post.content, (post as unknown as Record<string, unknown>).caption as string | undefined) || "",
    likes: Number(
      pickFirst(
        (post as unknown as Record<string, unknown>).likesCount as number | undefined,
        post.likes?.length as number | undefined,
      ) || 0,
    ),
    comments: Number(
      pickFirst(
        (post as unknown as Record<string, unknown>).commentsCount as number | undefined,
        (post as unknown as Record<string, unknown>).comments?.length as number | undefined,
      ) || 0,
    ),
    avatarUrl: getAvatarUrl({
      username,
      avatarUrl: (post as unknown as Record<string, unknown>).authorAvatarUrl as string | undefined,
      profileImage: (post as unknown as Record<string, unknown>).authorProfileImage as string | undefined,
    }),
    commentsList: [],
    likedByMe: Boolean((post as unknown as Record<string, unknown>).likedByMe),
  };
}

export default function Reel() {
  const api = useApi();
  const [reels, setReels] = useState<Reel[]>([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const videosRef = useRef<(HTMLVideoElement | null)[]>([]);
  const prevIndexRef = useRef<number>(0);
  const lockRef = useRef(false);
  const touchStartYRef = useRef<number | null>(null);
  const touchDeltaYRef = useRef(0);
  const suppressTapRef = useRef(false);

  const loadReels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/posts?page=1&limit=100");
      const rawItems = res?.data?.items || res?.data?.posts || res?.items || [];
      const items = (Array.isArray(rawItems) ? rawItems : []) as Post[];
      const mapped = items.map(toReel).filter(Boolean) as Reel[];
      setReels(mapped);
      setIndex((prev) => clamp(prev, 0, Math.max(mapped.length - 1, 0)));
    } catch {
      setReels([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadReels();
  }, [loadReels]);

  const goTo = useCallback(
    (nextValue: number) => {
      const nextIndex = clamp(nextValue, 0, reels.length - 1);
      if (nextIndex === index) return;
      setIndex(nextIndex);
      setPaused(false);
      setCommentsOpen(false);
    },
    [index, reels.length],
  );

  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const prev = useCallback(() => goTo(index - 1), [goTo, index]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (commentsOpen || reels.length === 0) return;
      e.preventDefault();
      if (lockRef.current) return;
      const dy = e.deltaY;
      if (Math.abs(dy) < 12) return;
      lockRef.current = true;
      if (dy > 0) next();
      else prev();
      window.setTimeout(() => {
        lockRef.current = false;
      }, 520);
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel as EventListener);
  }, [commentsOpen, next, prev, reels.length]);

  useEffect(() => {
    const prevV = videosRef.current[prevIndexRef.current];
    const curV = videosRef.current[index];
    setProgress(0);

    if (prevV && prevIndexRef.current !== index) {
      try {
        prevV.pause();
        prevV.currentTime = 0;
      } catch {}
    }

    if (curV) {
      try {
        curV.muted = muted;
        curV.currentTime = 0;
        const p = curV.play();
        if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch(() => {});
      } catch {}
    }

    prevIndexRef.current = index;
  }, [index, muted, reels.length]);

  useEffect(() => {
    const v = videosRef.current[index];
    if (!v) return;
    const onTime = () => {
      const dur = v.duration || 0;
      setProgress(dur ? v.currentTime / dur : 0);
    };
    const onPause = () => setPaused(true);
    const onPlay = () => setPaused(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("durationchange", onTime);
    v.addEventListener("loadedmetadata", onTime);
    v.addEventListener("pause", onPause);
    v.addEventListener("play", onPlay);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("durationchange", onTime);
      v.removeEventListener("loadedmetadata", onTime);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("play", onPlay);
    };
  }, [index, reels]);

  const togglePlayPause = () => {
    if (suppressTapRef.current) {
      suppressTapRef.current = false;
      return;
    }

    const cur = videosRef.current[index];
    if (!cur) return;
    if (cur.paused) {
      cur.muted = muted;
      const p = cur.play();
      if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch(() => {});
      setPaused(false);
    } else {
      cur.pause();
      setPaused(true);
    }
  };

  const toggleLike = async () => {
    const active = reels[index];
    if (!active) return;
    const liked = !active.likedByMe;
    setReels((prev) =>
      prev.map((item, idx) =>
        idx !== index ? item : { ...item, likedByMe: liked, likes: Math.max(0, item.likes + (liked ? 1 : -1)) },
      ),
    );
    try {
      if (liked) await api.post(`/posts/${active.postId}/like`, {});
      else await api.del(`/posts/${active.postId}/like`);
    } catch {
      setReels((prev) =>
        prev.map((item, idx) => (idx !== index ? item : { ...item, likedByMe: active.likedByMe, likes: active.likes })),
      );
    }
  };

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (commentsOpen || event.touches.length !== 1) return;
    touchStartYRef.current = event.touches[0].clientY;
    touchDeltaYRef.current = 0;
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (commentsOpen || touchStartYRef.current == null || event.touches.length !== 1) return;
    touchDeltaYRef.current = event.touches[0].clientY - touchStartYRef.current;
  };

  const handleTouchEnd = () => {
    if (commentsOpen || touchStartYRef.current == null) {
      touchStartYRef.current = null;
      touchDeltaYRef.current = 0;
      return;
    }

    const deltaY = touchDeltaYRef.current;
    touchStartYRef.current = null;
    touchDeltaYRef.current = 0;

    if (Math.abs(deltaY) < 56) return;

    suppressTapRef.current = true;
    if (deltaY < 0) next();
    else prev();

    window.setTimeout(() => {
      suppressTapRef.current = false;
    }, 220);
  };

  const openComments = () => {
    if (!reels[index]) return;
    setCommentsOpen(true);
  };

  const active = reels[index];
  const activeComments = useMemo(() => active?.commentsList || [], [active?.commentsList]);
  const handleCommentCountChange = useCallback((count: number) => {
    setReels((prev) => {
      let changed = false;
      const next = prev.map((item, idx) => {
        if (idx !== index || item.comments === count) return item;
        changed = true;
        return { ...item, comments: count };
      });
      return changed ? next : prev;
    });
  }, [index]);

  if (loading) return <div className="ig-reels"><div className="ig-reels__empty">Đang tải reels...</div></div>;
  if (!reels.length) return <div className="ig-reels"><div className="ig-reels__empty">Chưa có reel nào.</div></div>;

  return (
    <div className="ig-reels">
      <div className={`ig-reels__shell ${commentsOpen ? "is-comments-open" : ""}`}>
        <div className={`ig-reels__center ${commentsOpen ? "is-comments-open" : ""}`}>
          <div className="ig-reels__card">
            <div
              className="ig-reels__viewport"
              onClick={togglePlayPause}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
            >
              <div className="ig-reels__slider" style={{ transform: `translateY(${-index * 100}%)` }}>
                {reels.map((r, i) => (
                  <article className="ig-reels__slide" key={r.id}>
                    <div className="ig-reels__progress">
                      <div className="ig-reels__progressFill" style={{ transform: `scaleX(${i === index ? progress : 0})` }} />
                    </div>
                    <video
                      ref={(el) => {
                        videosRef.current[i] = el;
                      }}
                      className="ig-reels__video"
                      src={r.src}
                      poster={r.poster}
                      playsInline
                      loop
                      preload="metadata"
                    />
                    <button
                      className="ig-reels__mute"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMuted((m) => !m);
                      }}
                    >
                      {muted ? "🔇" : "🔊"}
                    </button>
                    {i === index && paused ? <div className="ig-reels__playOverlay">▶</div> : null}

                    <div className="ig-reels__overlay">
                      <div className="ig-reels__metaRow">
                        <img className="ig-reels__avatar" src={r.avatarUrl} alt={r.username} />
                        <div className="ig-reels__userBlock">
                          <div className="ig-reels__username">{r.username}</div>
                          {r.handle ? <div className="ig-reels__handle">@{r.handle}</div> : null}
                        </div>
                        <button type="button" className="ig-reels__follow">Follow</button>
                      </div>
                      <div className="ig-reels__caption">{r.caption || "Video reel"}</div>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div className="ig-reels__rail">
              <button className={`ig-reels__railBtn ${active.likedByMe ? "is-liked" : ""}`} type="button" onClick={toggleLike}>
                <span className="ig-reels__icon">♡</span>
                <span className="ig-reels__count">{active.likes}</span>
              </button>
              <button className={`ig-reels__railBtn ${commentsOpen ? "is-active" : ""}`} type="button" onClick={() => (commentsOpen ? setCommentsOpen(false) : openComments())}>
                <span className="ig-reels__icon">💬</span>
                <span className="ig-reels__count">{active.comments}</span>
              </button>
              <button className="ig-reels__railBtn" type="button">
                <span className="ig-reels__icon">↻</span>
                <span className="ig-reels__count">0</span>
              </button>
              <button className="ig-reels__railBtn" type="button">
                <span className="ig-reels__icon">✈</span>
              </button>
              <button className="ig-reels__railBtn" type="button">
                <span className="ig-reels__icon">🔖</span>
              </button>
              <button className="ig-reels__railBtn ig-reels__railBtn--more" type="button">
                <span className="ig-reels__icon">⋯</span>
              </button>
              <div className="ig-reels__thumbDock">
                <video src={active.src} poster={active.poster} muted playsInline />
              </div>
            </div>
          </div>

          <div className="ig-reels__nav">
            <button className="ig-reels__navBtn" type="button" onClick={prev} disabled={index === 0}>˄</button>
            <button className="ig-reels__navBtn" type="button" onClick={next} disabled={index === reels.length - 1}>˅</button>
          </div>
        </div>

        <ReelComments
          isOpen={commentsOpen}
          postId={active.postId}
          reelUsername={active.username}
          comments={activeComments}
          onClose={() => setCommentsOpen(false)}
          onCountChange={handleCommentCountChange}
        />
      </div>
    </div>
  );
}
