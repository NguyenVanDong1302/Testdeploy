import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth'

function readEnv(name: keyof ImportMetaEnv) {
  return import.meta.env[name]?.trim() ?? ''
}

const firebaseConfig = {
  apiKey: "AIzaSyAbxEoVwwBegiw2DgbIO13-TzGRkm-Pof4",
  authDomain: "facebook-ui-6f536.firebaseapp.com",
  databaseURL: "https://facebook-ui-6f536-default-rtdb.firebaseio.com",
  projectId: "facebook-ui-6f536",
  storageBucket: "facebook-ui-6f536.appspot.com",
  messagingSenderId: "981330345553",
  appId: "1:981330345553:web:2aba868806e6ce6f424270",
  measurementId: "G-J8E1NRDSC4"
};

const requiredEnvKeys: Array<keyof typeof firebaseConfig> = [
  'apiKey',
  'authDomain',
  'projectId',
  'appId',
]

function isPlaceholder(value: string) {
  const normalized = value.toLowerCase()
  return (
    !value ||
    normalized.includes('your_') ||
    normalized.includes('example') ||
    normalized === 'undefined'
  )
}

const missingKeys = requiredEnvKeys.filter((key) => isPlaceholder(firebaseConfig[key] ?? ''))

export const firebaseConfigError = missingKeys.length
  ? `Firebase chưa được cấu hình đúng. Thiếu hoặc sai các biến: ${missingKeys.join(', ')}.`
  : ''

let appInstance: FirebaseApp | null = null
let authInstance: Auth | null = null
let googleProviderInstance: GoogleAuthProvider | null = null

function ensureFirebase() {
  if (firebaseConfigError) {
    throw new Error(firebaseConfigError)
  }

  if (!appInstance) {
    appInstance = getApps().length ? getApp() : initializeApp(firebaseConfig)
  }

  if (!authInstance) {
    authInstance = getAuth(appInstance)
  }

  if (!googleProviderInstance) {
    googleProviderInstance = new GoogleAuthProvider()
    googleProviderInstance.setCustomParameters({ prompt: 'select_account' })
  }

  return {
    app: appInstance,
    auth: authInstance,
    googleProvider: googleProviderInstance,
  }
}

export function getFirebaseServices() {
  return ensureFirebase()
}
