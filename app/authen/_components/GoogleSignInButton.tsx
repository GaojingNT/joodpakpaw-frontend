'use client'

import Script from 'next/script'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { googleSignIn } from '@/lib/api'
import { getApiErrorMessages } from '@/lib/errorHandling'
import { useAuth } from '@/app/_components/AuthContext'

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID

interface GoogleCredentialResponse {
  credential: string
}

interface GoogleAccountsId {
  initialize: (config: {
    client_id: string
    callback: (response: GoogleCredentialResponse) => void
  }) => void
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } }
  }
}

interface GoogleSignInButtonProps {
  returnUrl: string
  onError: (message: string) => void
  onSuccess?: () => void
}

export default function GoogleSignInButton({ returnUrl, onError, onSuccess }: GoogleSignInButtonProps) {
  const router = useRouter()
  const { login } = useAuth()
  const buttonRef = useRef<HTMLDivElement>(null)
  const [isScriptLoaded, setIsScriptLoaded] = useState(
    () => typeof window !== 'undefined' && !!window.google?.accounts?.id
  )

  const handleCredential = useCallback(
    async (response: GoogleCredentialResponse) => {
      try {
        const data = await googleSignIn(response.credential)
        const user = await login(data.accessToken, data.refreshToken)
        const isAdmin = user?.role.some((r) => r.name === 'admin')
        onSuccess?.()
        router.push(isAdmin ? '/admin/dashboard' : returnUrl)
      } catch (err: unknown) {
        console.error('Google sign in failed:', err)
        const messages = getApiErrorMessages(err)
        onError(messages?.[0]?.message || 'Google sign in failed. Please try again.')
      }
    },
    [login, onError, onSuccess, returnUrl, router]
  )

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !isScriptLoaded || !buttonRef.current || !window.google) return

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredential,
    })
    window.google.accounts.id.renderButton(buttonRef.current, {
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      width: buttonRef.current.offsetWidth || 320,
    })
  }, [isScriptLoaded, handleCredential])

  // Hide Google sign-in when no client ID is configured
  if (!GOOGLE_CLIENT_ID) return null

  return (
    <>
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        // onReady also fires when the script was already loaded by another instance
        onReady={() => setIsScriptLoaded(true)}
      />
      <div ref={buttonRef} className="w-full flex justify-center" />
    </>
  )
}
