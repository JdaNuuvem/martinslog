'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { api, mensagemDeErro, type Loja, type ResumoConversa } from './api'
import { ConversaAberta } from './conversa-aberta'
import { escolherLoja } from './formatadores'
import { ListaConversas } from './lista'
import { useConversas } from './usar-conversas'

/** Espera da busca: 300 ms é o bastante para não consultar a cada letra digitada. */
const ATRASO_BUSCA_MS = 300

/**
 * Caixa de entrada do WhatsApp, no desenho do WhatsApp Web: lista à
 * esquerda, conversa à direita.
 *
 * Abaixo de `lg` não cabem as duas colunas com conforto, então aparece uma
 * de cada vez — a lista, e ao abrir uma conversa, só ela, com botão de voltar.
 */
export function CaixaDeEntrada({ perfilIdInicial }: { perfilIdInicial: string | null }) {
  const [lojas, setLojas] = useState<Loja[] | null>(null)
  const [erroLojas, setErroLojas] = useState<string | null>(null)
  const [perfilId, setPerfilId] = useState<string | null>(null)
  const [textoBusca, setTextoBusca] = useState('')
  const [busca, setBusca] = useState('')
  const [selecionada, setSelecionada] = useState<ResumoConversa | null>(null)
  const [sincronizando, setSincronizando] = useState(false)
  const [avisoSincronia, setAvisoSincronia] = useState<string | null>(null)

  const lista = useConversas(perfilId, busca)

  useEffect(() => {
    api
      .listarLojas()
      .then((r) => {
        setLojas(r.lojas)
        setPerfilId(escolherLoja(r.lojas, perfilIdInicial))
      })
      .catch((e: unknown) => setErroLojas(mensagemDeErro(e)))
  }, [perfilIdInicial])

  useEffect(() => {
    const timer = setTimeout(() => setBusca(textoBusca.trim()), ATRASO_BUSCA_MS)
    return () => clearTimeout(timer)
  }, [textoBusca])

  const trocarLoja = useCallback((id: string) => {
    setPerfilId(id)
    setSelecionada(null)
    setAvisoSincronia(null)
    // Guarda a loja no endereço sem navegar: recarregar a página ou voltar
    // dos templates cai de novo na mesma loja.
    window.history.replaceState(null, '', `/conversas?perfilId=${encodeURIComponent(id)}`)
  }, [])

  const abrir = useCallback((conversa: ResumoConversa) => setSelecionada(conversa), [])

  const voltar = useCallback(() => {
    const id = selecionada?.id
    setSelecionada(null)
    // No celular a lista volta a aparecer; o foco volta para a conversa de onde se saiu.
    requestAnimationFrame(() => id && document.getElementById(`conversa-${id}`)?.focus())
  }, [selecionada])

  async function sincronizar() {
    if (!perfilId) return
    setSincronizando(true)
    setAvisoSincronia(null)
    try {
      const r = await api.sincronizar(perfilId)
      setAvisoSincronia(`Sincronizado: ${r.conversas} conversas e ${r.mensagens} mensagens.`)
      await lista.recarregar()
    } catch (e) {
      setAvisoSincronia(mensagemDeErro(e))
    } finally {
      setSincronizando(false)
    }
  }

  if (erroLojas) {
    return (
      <p role="alert" className="rounded-cartao bg-erro-fundo p-4 text-dado text-erro">
        {erroLojas}
      </p>
    )
  }

  if (lojas && lojas.length === 0) {
    return (
      <div className="flex max-w-leitura flex-col items-start gap-3 rounded-cartao bg-superficie-card p-bloco shadow-elevado">
        <h1 className="text-titulo font-bold text-texto-principal">Conversas</h1>
        <p className="text-corpo text-texto-secundario">
          Nenhuma loja tem WhatsApp configurado. Conecte o celular da loja pelo QR code para ver e responder as conversas aqui.
        </p>
        <Link href="/whatsapp" className="rounded-pilula bg-brand px-6 py-2 text-dado font-medium text-white hover:bg-brand-light">
          Conectar WhatsApp
        </Link>
      </div>
    )
  }

  // A conversa aberta acompanha a versão mais nova do resumo que a lista trouxer (nome, foto).
  const aberta = selecionada ? (lista.conversas.find((c) => c.id === selecionada.id) ?? selecionada) : null

  return (
    <>
      <h1 className="sr-only">Conversas do WhatsApp</h1>
      {/*
        Altura da janela menos o cabeçalho (64px) e os respiros do shell
        (pt-bloco + pb-secao; pt-secao + pb-secao no desktop): a caixa ocupa
        a tela útil e cada coluna rola por dentro, como no WhatsApp Web.
      */}
      <div className="flex h-[calc(100dvh_-_64px_-_4rem)] min-h-[28rem] overflow-hidden rounded-painel bg-superficie-card shadow-elevado lg:h-[calc(100dvh_-_64px_-_5rem)]">
        <div
          className={`${aberta ? 'hidden lg:flex' : 'flex'} w-full min-w-0 flex-col border-r border-superficie-bloco lg:w-[22rem] lg:shrink-0 xl:w-[26rem]`}
        >
          {lojas && perfilId ? (
            <ListaConversas
              lojas={lojas}
              perfilId={perfilId}
              aoTrocarLoja={trocarLoja}
              textoBusca={textoBusca}
              buscaAplicada={busca}
              aoMudarBusca={setTextoBusca}
              conversas={lista.conversas}
              carregando={lista.carregando}
              carregandoMais={lista.carregandoMais}
              temMais={Boolean(lista.proximoCursor)}
              erro={lista.erro}
              aoCarregarMais={() => void lista.carregarMais()}
              aoRecarregar={() => void lista.recarregar()}
              selecionadaId={aberta?.id ?? null}
              aoAbrir={abrir}
              sincronizando={sincronizando}
              avisoSincronia={avisoSincronia}
              aoSincronizar={() => void sincronizar()}
            />
          ) : (
            <p className="p-4 text-dado text-texto-secundario">Carregando lojas…</p>
          )}
        </div>

        <div className={`${aberta ? 'flex' : 'hidden lg:flex'} min-w-0 flex-1 flex-col`}>
          {aberta && perfilId ? (
            <ConversaAberta
              key={aberta.id}
              conversa={aberta}
              perfilId={perfilId}
              aoVoltar={voltar}
              aoAtualizarResumo={lista.atualizar}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 border-b-[6px] border-b-[#25d366] bg-[#f0f2f5] p-8 text-center">
              <p className="text-subtitulo font-light text-[#41525d]">Escolha uma conversa</p>
              <p className="max-w-leitura text-dado text-[#667781]">
                Responda por texto, áudio ou anexo pelo WhatsApp conectado. Digite “/” no campo para usar um template.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
