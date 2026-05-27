import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, resolveMediaUrl } from '../../lib/api';
import { combineResponsiveStyles } from '../../lib/combineResponsiveStyles';
import styles from './SearchPanel.module.css';
import desktopStyles from './SearchPanel.desktop.module.css';
import tabletStyles from './SearchPanel.tablet.module.css';
import mobileStyles from './SearchPanel.mobile.module.css';

type SearchUser = {
  _id?: string;
  id?: string;
  username?: string;
  fullName?: string;
  name?: string;
  displayName?: string;
  avatar?: string;
  avatarUrl?: string;
  image?: string;
  profilePicture?: string;
  bio?: string;
  mutualText?: string;
  subtitle?: string;
  email?: string;
};

type Props = {
  open?: boolean;
  isOpen?: boolean;
  users?: SearchUser[];
  results?: SearchUser[];
  items?: SearchUser[];
  allUsers?: SearchUser[];
  keyword?: string;
  query?: string;
  onClose: () => void;
  onSelectUser?: (user: SearchUser) => void;
  onSelect?: (user: SearchUser) => void;
};

const CLOSE_ANIMATION_MS = 220;
const responsiveStyles = combineResponsiveStyles(desktopStyles, tabletStyles, mobileStyles);

function resolveAvatar(user: SearchUser) {
  const src = user.avatarUrl || user.avatar || user.image || user.profilePicture || '';
  if (!src) return '';
  return resolveMediaUrl(src);
}

function getDisplayName(user: SearchUser) {
  return user.fullName || user.name || user.displayName || '';
}

function getSubtitle(user: SearchUser) {
  if (user.subtitle) return user.subtitle;
  const name = getDisplayName(user);
  if (user.mutualText) return `${name}${name ? ' • ' : ''}${user.mutualText}`;
  if (user.bio) return `${name}${name ? ' • ' : ''}${user.bio}`;
  if (user.email) return `${name}${name ? ' • ' : ''}${user.email}`;
  return name;
}

export default function SearchPanel(props: Props) {
  const {
    open,
    isOpen,
    users,
    results,
    items,
    allUsers,
    keyword = '',
    query = '',
    onClose,
    onSelectUser,
    onSelect,
  } = props;

  const api = useApi();
  const navigate = useNavigate();
  const visible = typeof open === 'boolean' ? open : !!isOpen;
  const initialQuery = keyword || query || '';
  const [localQuery, setLocalQuery] = useState(initialQuery);
  const [shouldRender, setShouldRender] = useState(visible);
  const [fetchedUsers, setFetchedUsers] = useState<SearchUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setShouldRender(false);
    }, CLOSE_ANIMATION_MS);

    return () => window.clearTimeout(timer);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    setLocalQuery(initialQuery);
    const id = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [visible, initialQuery]);

  const propUsers = useMemo<SearchUser[]>(() => {
    const raw = users ?? results ?? items ?? allUsers ?? [];
    return Array.isArray(raw) ? raw.filter(Boolean) : [];
  }, [users, results, items, allUsers]);

  useEffect(() => {
    if (propUsers.length > 0) return;

    let cancelled = false;
    setIsLoading(true);
    setLoadError('');

    api
      .get('/users')
      .then((res) => {
        if (cancelled) return;
        const data = Array.isArray(res?.data) ? res.data : [];
        setFetchedUsers(data);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError('Không tải được danh sách người dùng.');
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [api, propUsers.length]);

  const sourceUsers = propUsers.length > 0 ? propUsers : fetchedUsers;

  const normalizedUsers = useMemo<SearchUser[]>(() => {
    const seen = new Set<string>();
    return sourceUsers.filter((user, index) => {
      const key = user._id || user.id || user.username || `${getDisplayName(user)}-${index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [sourceUsers]);

  const filteredUsers = useMemo(() => {
    const q = localQuery.trim().toLowerCase();
    if (!q) return normalizedUsers;

    return normalizedUsers.filter((user) => {
      const username = (user.username || '').toLowerCase();
      const fullName = getDisplayName(user).toLowerCase();
      const bio = (user.bio || '').toLowerCase();
      const email = (user.email || '').toLowerCase();
      return username.includes(q) || fullName.includes(q) || bio.includes(q) || email.includes(q);
    });
  }, [normalizedUsers, localQuery]);

  const handleUserClick = (user: SearchUser) => {
    if (onSelectUser) {
      onSelectUser(user);
      return;
    }

    if (onSelect) {
      onSelect(user);
      return;
    }

    if (!user.username) return;
    navigate(`/profile/${encodeURIComponent(user.username)}`);
    onClose();
  };

  if (!shouldRender) return null;

  return (
    <>
        <div
        className={`${styles.overlay} ${responsiveStyles.overlay} ${visible ? styles.overlayVisible : styles.overlayHidden}`}
        onClick={onClose}
      />
      <aside
        className={`${styles.panel} ${responsiveStyles.panel} ${visible ? styles.panelOpen : styles.panelClosed}`}
        aria-label="Search panel"
      >
        <div className={`${styles.header} ${responsiveStyles.header}`}>
          <h2 className={`${styles.title} ${responsiveStyles.title}`}>Search</h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close search"
          >
            ×
          </button>
        </div>

        <div className={`${styles.searchBox} ${responsiveStyles.searchBox}`}>
          <input
            ref={inputRef}
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
            placeholder="Search"
            className={styles.searchInput}
          />
          {!!localQuery && (
            <button
              type="button"
              className={`${styles.clearButton} ${responsiveStyles.clearButton}`}
              onClick={() => {
                setLocalQuery('');
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        <div className={`${styles.results} ${responsiveStyles.results}`}>
          {isLoading && normalizedUsers.length === 0 ? (
            <div className={styles.empty}>Đang tải danh sách người dùng...</div>
          ) : loadError && normalizedUsers.length === 0 ? (
            <div className={styles.empty}>{loadError}</div>
          ) : filteredUsers.length === 0 ? (
            <div className={styles.empty}>
              {normalizedUsers.length === 0 ? 'No users available.' : 'No results found.'}
            </div>
          ) : (
            filteredUsers.map((user, index) => {
              const key = user._id || user.id || user.username || `search-user-${index}`;
              const subtitle = getSubtitle(user);
              const username = user.username || 'unknown';
              const avatar = resolveAvatar(user);

              return (
                <button
                  key={key}
                  type="button"
                  className={`${styles.userItem} ${responsiveStyles.userItem}`}
                  onClick={() => handleUserClick(user)}
                >
                  <div className={styles.avatarWrap}>
                    {avatar ? (
                      <img src={avatar} alt={username} className={styles.avatar} />
                    ) : (
                      <div className={styles.avatarFallback}>{username.charAt(0).toUpperCase()}</div>
                    )}
                  </div>

                  <div className={styles.userMeta}>
                    <div className={styles.username}>{username}</div>
                    {!!subtitle && <div className={styles.subtitle}>{subtitle}</div>}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}
