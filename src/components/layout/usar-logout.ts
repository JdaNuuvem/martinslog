'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Encerra a sessão e leva o usuário para `/login`.
 *
 * Redireciona mesmo se a chamada à API falhar: a intenção de quem clicou é
 * sair, e deixá-lo preso numa tela autenticada por causa de uma falha de
 * rede é pior do que mandá-lo para o login com a sessão possivelmente ainda
 * viva no servidor — que ele pode encerrar tentando de novo.
 */
export function useLogout() {
  const router = useRouter()
  const [saindo, setSaindo] = useState(false)

  async function sair(): Promise<void> {
    if (saindo) return
    setSaindo(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch (error) {
      console.error('Falha ao encerrar sessão', { cause: error })
    } finally {
      router.push('/login')
    }
  }

  return { sair, saindo }
}
