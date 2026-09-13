'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, mensagemDeErro, type ResumoConversa } from './api'
import { mesclarConversas } from './formatadores'

/**
 * A lista recarrega a primeira página a cada 10 s — o dobro do intervalo da
 * conversa aberta. Quem está na lista quer ver que chegou algo; quem está
 * dentro de uma conversa quer ver a resposta, e é ali que o atraso incomoda.
 */
const INTERVALO_LISTA_MS = 10_000

export function useConversas(perfilId: string | null, busca: string) {
  const [conversas, setConversas] = useState<ResumoConversa[]>([])
  const [proximoCursor, setProximoCursor] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // Descarta respostas de uma busca ou loja que já não é a da tela.
  const geracao = useRef(0)

  const recarregar = useCallback(async () => {
    if (!perfilId) return
    const minha = ++geracao.current
    setCarregando(true)
    setErro(null)
    try {
      const r = await api.listarConversas({ perfilId, busca })
      if (minha !== geracao.current) return
      setConversas(r.conversas)
      setProximoCursor(r.proximoCursor)
    } catch (e) {
      if (minha === geracao.current) setErro(mensagemDeErro(e))
    } finally {
      if (minha === geracao.current) setCarregando(false)
    }
  }, [perfilId, busca])

  useEffect(() => {
    setConversas([])
    setProximoCursor(null)
    void recarregar()
  }, [recarregar])

  const carregarMais = useCallback(async () => {
    if (!perfilId || !proximoCursor || carregandoMais) return
    const minha = geracao.current
    setCarregandoMais(true)
    try {
      const r = await api.listarConversas({ perfilId, busca, cursor: proximoCursor })
      if (minha !== geracao.current) return
      setConversas((atuais) => mesclarConversas(atuais, r.conversas))
      setProximoCursor(r.proximoCursor)
    } catch (e) {
      setErro(mensagemDeErro(e))
    } finally {
      setCarregandoMais(false)
    }
  }, [perfilId, busca, proximoCursor, carregandoMais])

  useEffect(() => {
    // Durante uma busca a lista é resultado, não caixa de entrada: reordenar
    // por mensagem nova embaralharia o que a pessoa está procurando.
    if (!perfilId || busca) return
    const timer = setInterval(async () => {
      if (document.hidden) return
      const minha = geracao.current
      try {
        const r = await api.listarConversas({ perfilId })
        if (minha === geracao.current) setConversas((atuais) => mesclarConversas(atuais, r.conversas))
      } catch {
        // A próxima volta tenta de novo.
      }
    }, INTERVALO_LISTA_MS)
    return () => clearInterval(timer)
  }, [perfilId, busca])

  const atualizar = useCallback((id: string, mudanca: Partial<ResumoConversa>) => {
    setConversas((atuais) => atuais.map((c) => (c.id === id ? { ...c, ...mudanca } : c)))
  }, [])

  return { conversas, proximoCursor, carregando, carregandoMais, erro, recarregar, carregarMais, atualizar }
}
