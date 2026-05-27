import { Outlet, Route, Routes } from 'react-router-dom'
import AppLayout from '../components/layout/AppLayout'
import { SocketProvider } from '../state/socket'
import { AppStoreProvider } from '../state/store'
import HomePage from '../pages/Home/HomePage'
import ExplorePage from '../pages/ExplorePage'
import ProfilePage from '../pages/Profile/ProfilePage'
import NotificationsPage from '../pages/NotificationsPage'
import SettingsPage from '../pages/SettingsPage'
import { ToastHost, ToastProvider } from '../components/Toast'
import { ModalProvider } from '../components/Modal'
import ReelsPage from '../pages/Reel/Reel'
import MessagesPage from '../pages/Messages/MessagesPage'
import SearchPage from '../pages/SearchPage'
import CreatePostPage from '../pages/CreatePostPage'
import PostPage from '../pages/PostPage'
import AdminPage from '../pages/Admin/AdminPage'
import LoginPage from '../pages/Auth/LoginPage'
import AccountLockedPage from '../pages/Auth/AccountLockedPage'
import RegisterPage from '../pages/Auth/RegisterPage'
import { AuthProvider } from '../features/auth/AuthProvider'
import { NotificationProvider } from '../features/notifications/NotificationProvider'
import { MessageIndicatorProvider } from '../features/messages/MessageIndicatorProvider'
import { CallsProvider } from '../features/calls/CallsProvider'
import ProtectedRoute from '../features/auth/ProtectedRoute'

function ProtectedShell() {
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  )
}

export default function App() {
  return (
    <AppStoreProvider>
      <ToastProvider>
        <AuthProvider>
          <SocketProvider>
            <CallsProvider>
              <MessageIndicatorProvider>
                <NotificationProvider>
                  <ModalProvider>
                  <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route path="/account-locked" element={<AccountLockedPage />} />

                    <Route element={<ProtectedRoute />}>
                      <Route element={<ProtectedShell />}>
                        <Route path="/" element={<HomePage />} />
                        <Route path="/explore" element={<ExplorePage />} />
                        <Route path="/profile/:username" element={<ProfilePage />} />
                        <Route path="/notifications" element={<NotificationsPage />} />
                        <Route path="/settings" element={<SettingsPage />} />
                        <Route path="/reels" element={<ReelsPage />} />
                        <Route path="/messages" element={<MessagesPage />} />
                        <Route path="/search" element={<SearchPage />} />
                        <Route path="/create" element={<CreatePostPage />} />
                        <Route path="/post/:id" element={<PostPage />} />
                        <Route path="/admin" element={<AdminPage />} />
                      </Route>
                    </Route>
                  </Routes>
                  </ModalProvider>
                  <ToastHost />
                </NotificationProvider>
              </MessageIndicatorProvider>
            </CallsProvider>
          </SocketProvider>
        </AuthProvider>
      </ToastProvider>
    </AppStoreProvider>
  )
}
